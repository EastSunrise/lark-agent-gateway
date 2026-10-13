import {it,expect,afterEach} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execa} from 'execa';
import pino from 'pino';
import type {NormalizedMessage} from '@larksuite/channel';
import {configSchema} from '../../src/config/schema.js';
import {openDatabase} from '../../src/storage/database.js';
import {Store} from '../../src/storage/repositories.js';
import {OwnerService} from '../../src/identity/owner-service.js';
import {RepoRegistry} from '../../src/repos/registry.js';
import {RepoViewManager} from '../../src/repos/repo-view-manager.js';
import {ConversationManager} from '../../src/conversations/conversation-manager.js';
import {TaskManager} from '../../src/tasks/task-manager.js';
import {Gateway} from '../../src/gateway.js';
import {ApprovalManager} from '../../src/approvals/approval-manager.js';
import {DefaultRepoService} from '../../src/repos/default-repo-service.js';
const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const fn of cleanups.splice(0))await fn()});
async function setup(feishu:Record<string,unknown>={},agentArgs:string[]=[]){
  await mkdir('.test-tmp',{recursive:true});const root=await mkdtemp(resolve('.test-tmp/gateway-'));const repo=join(root,'repo');await mkdir(repo);
  await execa('git',['init',repo]);await writeFile(join(repo,'README.md'),'committed');
  await execa('git',['-C',repo,'add','README.md']);await execa('git',['-C',repo,'-c','user.name=Test','-c','user.email=test@localhost','commit','-m','fixture']);
  const config=configSchema.parse({feishu,repoDefaults:{defaultAgent:'fake'},repos:{test:{path:repo,defaultAgent:'fake'}},agents:{fake:{command:process.execPath,args:[resolve('tests/fixtures/fake-agent.mjs'),...agentArgs],groupRead:false}}});
  const db=openDatabase(join(root,'state'));const store=new Store(db);const owner=new OwnerService(db,'ou_owner');const registry=new RepoRegistry();await registry.initialize(config);
  const sent:{to:string;input:unknown;opts:unknown}[]=[];const channel={send:async(to:string,input:unknown,opts?:unknown)=>{sent.push({to,input,opts});return {messageId:'card'+sent.length}},updateCard:async(_id:string,card:object)=>{sent.push({to:'update',input:card,opts:{}})}};
  const views=new RepoViewManager(registry,join(root,'state'));const conversations=new ConversationManager(store);
  const tasks=new TaskManager(config,store,owner,views,conversations,channel,join(root,'state'),pino({enabled:false}));
  const defaults=new DefaultRepoService(config,store,registry,join(root,'state'));
  const gateway=new Gateway(config,store,owner,registry,tasks,channel,false,defaults);
  cleanups.push(async()=>{await tasks.close();db.close()});
  const msg=(id:string,text:string,sender='ou_owner',group=false):NormalizedMessage=>({messageId:id,chatId:group?'group':'dm',chatType:group?'group':'p2p',senderId:sender,content:text,rawContentType:'text',resources:[],mentions:[],mentionedBot:group,mentionAll:false,rootId:group?'thread':undefined,createTime:Date.now()});
  const wait=async(status:string)=>{for(let i=0;i<300;i++){const row=db.prepare('SELECT status FROM tasks ORDER BY created_at DESC LIMIT 1').get() as {status:string}|undefined;if(row?.status===status)return;await new Promise(r=>setTimeout(r,20))}throw new Error('Timed out waiting for '+status)};
  return {repo,store,owner,registry,views,gateway,tasks,sent,msg,wait,conversations,channel,config,root};
}
it('Owner writes through message → task → ACP → repo → card; dedup and non-owner DM block',async()=>{
  const t=await setup();await t.gateway.message(t.msg('denied','edit','ou_member'));expect(t.store.db.prepare('SELECT COUNT(*) n FROM tasks').get()).toEqual({n:0});
  await t.gateway.message(t.msg('m1','edit'));await t.wait('COMPLETED');expect(await readFile(join(t.repo,'fake-created.txt'),'utf8')).toBe('changed');
  await t.gateway.message(t.msg('m1','edit'));expect(t.store.db.prepare('SELECT COUNT(*) n FROM tasks').get()).toEqual({n:1});
  expect(JSON.stringify(t.sent)).toContain('COMPLETED');expect(JSON.stringify(t.sent)).not.toContain('HIDDEN_THOUGHT');
});
it('/stop cancels running and all queued tasks even beyond the five displayed records',async()=>{
  const t=await setup();t.store.bind('group','test','fake','ou_owner');
  await t.gateway.message(t.msg('many0','wait','ou_owner',true));await t.wait('RUNNING');
  for(let i=1;i<8;i++){await new Promise(r=>setTimeout(r,3));await t.gateway.message(t.msg('many'+i,'wait','ou_owner',true))}
  await t.gateway.message(t.msg('stop-all','/stop','ou_owner',true));
  const rows=t.store.db.prepare('SELECT status FROM tasks').all() as {status:string}[];
  expect(rows).toHaveLength(8);expect(rows.every(x=>x.status==='CANCELLED')).toBe(true);
});
it('group WRITE fallback preserves its history without exposing it to READ after process restart',async()=>{
  const t=await setup({},['--no-load']);t.store.bind('group','test','fake','ou_owner');
  await t.gateway.message(t.msg('remember','WRITE_HISTORY_CANARY','ou_owner',true));await t.wait('COMPLETED');
  const conv=t.store.db.prepare('SELECT conversation_id FROM tasks').get() as {conversation_id:string};
  expect(t.conversations.context(conv.conversation_id,'owner-write')).toContain('WRITE_HISTORY_CANARY');
  expect(t.conversations.context(conv.conversation_id,'group-read')).not.toContain('WRITE_HISTORY_CANARY');
  await t.tasks.close();
  const tasks=new TaskManager(t.config,t.store,t.owner,t.views,t.conversations,t.channel,join(t.root,'state'),pino({enabled:false}));
  try{
    const id=tasks.submit(t.msg('continued','continue','ou_owner',true),t.store.conversation(conv.conversation_id),'owner-write');
    for(let i=0;i<400&&t.store.task(id)?.status!=='COMPLETED';i++)await new Promise(r=>setTimeout(r,15));
    expect(t.store.task(id)?.status).toBe('COMPLETED');
    expect((t.store.db.prepare('SELECT result_text FROM tasks WHERE id=?').get(id) as {result_text:string}).result_text).toContain('WRITE_HISTORY_CANARY');
    expect(t.conversations.context(conv.conversation_id,'group-read')).not.toContain('WRITE_HISTORY_CANARY');
  }finally{await tasks.close()}
});
it('failed final delivery retains successful result and /retry resends without executing Agent again',async()=>{
  const t=await setup();const update=t.channel.updateCard;let fail=true;
  t.channel.updateCard=async(id,card)=>{
    if(fail&&JSON.stringify(card).includes('COMPLETED'))throw new Error('DELIVERY_FAILED');
    await update(id,card);
  };
  await t.gateway.message(t.msg('result','hello'));
  let row:{id:string;status:string;error:string|null;delivery_status:string;result_text:string}|undefined;
  for(let i=0;i<400;i++){row=t.store.db.prepare('SELECT * FROM tasks').get() as typeof row;if(row?.delivery_status==='FAILED')break;await new Promise(r=>setTimeout(r,15))}
  expect(row?.status).toBe('COMPLETED');expect(row?.error).toBeNull();expect(row?.result_text).toContain('answer:hello');
  expect(await t.tasks.retryDelivery(row!.id,'ou_member','dm')).toBe(false);
  expect(await t.tasks.retryDelivery(row!.id,'ou_owner','other-chat')).toBe(false);
  fail=false;await t.gateway.message(t.msg('retry','/retry '+row!.id));
  expect(t.store.db.prepare('SELECT delivery_status FROM tasks WHERE id=?').get(row!.id)).toEqual({delivery_status:'DELIVERED'});
  expect(t.store.db.prepare('SELECT count(*) n FROM tasks').get()).toEqual({n:1});
});
it('cancelling pending permission returns ACP cancelled; explicit reject remains selected/reject_once',async()=>{
  const t=await setup();const c=t.conversations.findOrCreate('dm',true,'','test','fake');
  t.store.db.prepare('INSERT INTO tasks(id,conversation_id,requester_id,input_message_id,input_text,chat_type,status,created_at) VALUES(?,?,?,?,?,?,?,?)').run('cancel-permission',c.id,'ou_owner','cancel-permission-msg','permission','p2p','RUNNING',Date.now());
  const manager=new ApprovalManager(t.store,t.owner,t.channel,()=>{});
  const request={sessionId:'s',toolCall:{toolCallId:'t',title:'permission'},options:[{optionId:'a',name:'Allow',kind:'allow_once' as const},{optionId:'r',name:'Reject',kind:'reject_once' as const}]};
  const decision=manager.request(t.store.task('cancel-permission')!,'s','owner-write',request);
  manager.cancelTask('cancel-permission');expect(await decision).toEqual({outcome:{outcome:'cancelled'}});
  t.store.db.prepare("UPDATE tasks SET status='CANCELLED' WHERE id='cancel-permission'").run();
  expect(await manager.request(t.store.task('cancel-permission')!,'s','owner-write',request)).toEqual({outcome:{outcome:'cancelled'}});
  manager.close();
});
it('unbound group auto-creates only for Owner tasks, binds and completes without setup commands',async()=>{
  const t=await setup();await t.gateway.message(t.msg('auto-denied','hello','ou_member',true));
  expect(t.store.binding('group')).toBeUndefined();expect(t.store.db.prepare('SELECT count(*) n FROM managed_repos').get()).toEqual({n:0});
  await t.gateway.message(t.msg('auto-first','hello','ou_owner',true));await t.wait('COMPLETED');
  const bound=t.store.binding('group')!;expect(bound.repo_id).toMatch(/^auto-group-/);
  expect((await execa('git',['-C',t.registry.get(bound.repo_id).path,'rev-parse','HEAD'])).stdout).toMatch(/^[a-f0-9]{40}$/);
  await t.gateway.message(t.msg('auto-second','again','ou_owner',true));await t.wait('COMPLETED');
  expect(t.store.db.prepare('SELECT count(*) n FROM managed_repos').get()).toEqual({n:1});
  expect(t.store.db.prepare('SELECT count(*) n FROM conversations').get()).toEqual({n:1});
  expect(t.sent.filter(x=>x.to==='group').every(x=>(x.opts as {replyInThread:boolean}).replyInThread===false)).toBe(true);
});
it('ordinary group replies stay outside topics and consecutive messages reuse sender context',async()=>{
  const t=await setup({groupConversationScope:'sender'});await t.gateway.message(t.msg('plain-bind','/repo bind test','ou_owner',true));
  await t.gateway.message({...t.msg('plain1','hello1','ou_owner',true),rootId:undefined});await t.wait('COMPLETED');
  await t.gateway.message({...t.msg('plain2','hello2','ou_owner',true),rootId:'another-thread'});await t.wait('COMPLETED');
  const rows=t.store.db.prepare('SELECT conversation_id FROM tasks').all() as {conversation_id:string}[];
  expect(rows).toHaveLength(2);expect(rows[0].conversation_id).toBe(rows[1].conversation_id);
  const messages=t.sent.filter(x=>x.to==='group');
  expect(messages.length).toBeGreaterThan(2);
  for(const message of messages)expect(message.opts).toMatchObject({replyInThread:false});
  await t.gateway.message(t.msg('member-status','/status','ou_member',true));
  const count=t.store.db.prepare('SELECT count(*) n FROM conversations').get();expect(count).toEqual({n:2});
  await t.gateway.message(t.msg('member-new','/new','ou_member',true));
  expect(t.store.db.prepare("SELECT count(*) n FROM conversations WHERE active=1").get()).toEqual({n:1});
});
it('supports explicit shared ordinary context and retains optional thread isolation',async()=>{
  const shared=await setup({groupConversationScope:'chat'});
  shared.store.bind('group','test','fake','ou_owner');
  await shared.gateway.message(shared.msg('shared1','/status','ou_owner',true));
  await shared.gateway.message(shared.msg('shared2','/status','ou_member',true));
  expect(shared.store.db.prepare('SELECT count(*) n FROM conversations').get()).toEqual({n:1});
  await shared.gateway.message(shared.msg('shared-reset','/new','ou_member',true));
  expect(shared.store.db.prepare('SELECT count(*) n FROM conversations WHERE active=1').get()).toEqual({n:1});
  const thread=await setup({groupReplyMode:'thread'});thread.store.bind('group','test','fake','ou_owner');
  await thread.gateway.message({...thread.msg('thread1','/status','ou_owner',true),rootId:'t1'});
  await thread.gateway.message({...thread.msg('thread2','/status','ou_owner',true),rootId:'t2'});
  expect(thread.store.db.prepare('SELECT count(*) n FROM conversations').get()).toEqual({n:2});
  expect(thread.sent.every(x=>(x.opts as {replyInThread:boolean}).replyInThread)).toBe(true);
});
it('group binding requires Owner, security gate rejects members, dirty changes excluded from snapshot',async()=>{
  const t=await setup();await t.gateway.message(t.msg('b1','/repo bind test','ou_member',true));expect(t.store.binding('group')).toBeUndefined();
  await t.gateway.message(t.msg('b2','/repo bind test','ou_owner',true));expect(t.store.binding('group')?.repo_id).toBe('test');
  await t.gateway.message(t.msg('b3','hello','ou_member',true));expect(t.store.db.prepare('SELECT COUNT(*) n FROM tasks').get()).toEqual({n:0});
  await writeFile(join(t.repo,'README.md'),'dirty');const view=await t.views.createGroupView('test');
  expect(await readFile(join(view.cwd,'README.md'),'utf8')).toBe('committed');expect(view.readRoots).not.toContain(t.repo);
  await t.views.release(view);
});
it('approval rejects unauthorized actor, allows once, and cancel interrupts waiting turn',async()=>{
  const t=await setup();await t.gateway.message(t.msg('p1','permission'));await t.wait('WAITING_APPROVAL');
  const row=t.store.db.prepare("SELECT id FROM approvals WHERE status='PENDING'").get() as {id:string};
  expect(t.tasks.approvals.decide(row.id,'ou_member','allow')).toBe(false);expect(t.tasks.approvals.decide(row.id,'ou_owner','allow')).toBe(true);
  expect(t.tasks.approvals.decide(row.id,'ou_owner','allow')).toBe(false);await t.wait('COMPLETED');
  await t.gateway.message(t.msg('p2','wait'));await t.wait('RUNNING');const task=t.store.db.prepare('SELECT id FROM tasks ORDER BY created_at DESC LIMIT 1').get() as {id:string};
  expect(await t.tasks.cancel(task.id,'ou_member')).toBe(false);expect(await t.tasks.cancel(task.id,'ou_owner')).toBe(true);await t.wait('CANCELLED');
});
it('rejects non-canonical or escaping repo paths',async()=>{
  const t=await setup();const r=new RepoRegistry();
  await expect(r.initialize(configSchema.parse({repos:{bad:{path:'../relative'}}}))).rejects.toThrow(/absolute/);
  await mkdir(join(t.repo,'sub'));await expect(r.initialize(configSchema.parse({repos:{bad:{path:join(t.repo,'sub')}}}))).rejects.toThrow(/Git root/);
  await r.initialize(configSchema.parse({repos:{alias1:{path:t.repo},alias2:{path:t.repo}}}));
  const views=new RepoViewManager(r,join(t.repo,'state'));
  expect(views.ownerLockKey('alias1')).toBe(views.ownerLockKey('alias2'));
});
it('READ → WRITE uses separate process/session/cwd; write history never enters READ summary',async()=>{
  const t=await setup();t.store.bind('group','test','fake','ou_owner');
  const c=t.conversations.findOrCreate('group',false,'thread','test','fake');
  // Fake Agent verifies Gateway separation, not native sandbox enforcement.
  t.tasks.submit(t.msg('r1','analyze','ou_member',true),c,'group-read');await t.wait('COMPLETED');
  const summary=t.store.conversation(c.id).summary;
  t.tasks.submit(t.msg('w1','edit','ou_owner',true),c,'owner-write');await t.wait('COMPLETED');
  const sessions=t.store.db.prepare('SELECT id,profile,cwd FROM agent_sessions WHERE conversation_id=?').all(c.id) as {id:string;profile:string;cwd:string}[];
  expect(sessions).toHaveLength(2);expect(sessions[0].id).not.toBe(sessions[1].id);expect(sessions[0].cwd).not.toBe(sessions[1].cwd);
  expect(new Set(sessions.map(x=>x.profile))).toEqual(new Set(['group-read','owner-write']));
  expect(t.store.conversation(c.id).summary).toBe(summary);
  expect(await readFile(join(t.repo,'fake-created.txt'),'utf8')).toBe('changed');
});
it('read permission auto-denies; Owner reject/expiry settle once; restart marks unfinished tasks',async()=>{
  const t=await setup();const c=t.conversations.findOrCreate('dm',true,'','test','fake');
  t.store.db.prepare('INSERT INTO tasks(id,conversation_id,requester_id,input_message_id,input_text,chat_type,status,created_at) VALUES(?,?,?,?,?,?,?,?)').run('approval-task',c.id,'ou_owner','approval-message','permission','p2p','RUNNING',Date.now());
  const task=t.store.task('approval-task')!;
  const manager=new ApprovalManager(t.store,t.owner,t.channel,()=>{},80);
  const request={sessionId:'s',toolCall:{toolCallId:'t',title:'permission'},options:[{optionId:'a',name:'Allow',kind:'allow_once' as const},{optionId:'r',name:'Reject',kind:'reject_once' as const}]};
  expect(await manager.request(task,'s','group-read',request)).toEqual({outcome:{outcome:'cancelled'}});
  const pending=manager.request(task,'s','owner-write',request);
  const id=(t.store.db.prepare("SELECT id FROM approvals WHERE status='PENDING'").get() as {id:string}).id;
  expect(manager.decide(id,'ou_owner','reject')).toBe(true);expect(await pending).toEqual({outcome:{outcome:'selected',optionId:'r'}});
  expect(manager.decide(id,'ou_owner','allow')).toBe(false);
  expect(await manager.request(task,'s','owner-write',request)).toEqual({outcome:{outcome:'selected',optionId:'r'}});
  expect(t.store.db.prepare("SELECT count(*) n FROM approvals WHERE status='EXPIRED'").get()).toEqual({n:1});
  t.store.recover();expect(t.store.task(task.id)?.status).toBe('INTERRUPTED');manager.close();
});
