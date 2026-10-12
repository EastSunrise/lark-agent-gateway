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
const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const fn of cleanups.splice(0))await fn()});
async function setup(){
  await mkdir('.test-tmp',{recursive:true});const root=await mkdtemp(resolve('.test-tmp/gateway-'));const repo=join(root,'repo');await mkdir(repo);
  await execa('git',['init',repo]);await writeFile(join(repo,'README.md'),'committed');
  await execa('git',['-C',repo,'add','README.md']);await execa('git',['-C',repo,'-c','user.name=Test','-c','user.email=test@localhost','commit','-m','fixture']);
  const config=configSchema.parse({repos:{test:{path:repo,defaultAgent:'fake'}},agents:{fake:{command:process.execPath,args:[resolve('tests/fixtures/fake-agent.mjs')],groupRead:false}}});
  const db=openDatabase(join(root,'state'));const store=new Store(db);const owner=new OwnerService(db,'ou_owner');const registry=new RepoRegistry();await registry.initialize(config);
  const sent:{to:string;input:unknown;opts:unknown}[]=[];const channel={send:async(to:string,input:unknown,opts?:unknown)=>{sent.push({to,input,opts});return {messageId:'card'+sent.length}},updateCard:async(_id:string,card:object)=>{sent.push({to:'update',input:card,opts:{}})}};
  const views=new RepoViewManager(registry,join(root,'state'));const conversations=new ConversationManager(store);
  const tasks=new TaskManager(config,store,owner,views,conversations,channel,join(root,'state'),pino({enabled:false}));
  const gateway=new Gateway(config,store,owner,registry,tasks,channel,false);
  cleanups.push(async()=>{await tasks.close();db.close()});
  const msg=(id:string,text:string,sender='ou_owner',group=false):NormalizedMessage=>({messageId:id,chatId:group?'group':'dm',chatType:group?'group':'p2p',senderId:sender,content:text,rawContentType:'text',resources:[],mentions:[],mentionedBot:group,mentionAll:false,rootId:group?'thread':undefined,createTime:Date.now()});
  const wait=async(status:string)=>{for(let i=0;i<300;i++){const row=db.prepare('SELECT status FROM tasks ORDER BY created_at DESC LIMIT 1').get() as {status:string}|undefined;if(row?.status===status)return;await new Promise(r=>setTimeout(r,20))}throw new Error('Timed out waiting for '+status)};
  return {repo,store,owner,registry,views,gateway,tasks,sent,msg,wait,conversations,channel};
}
it('Owner writes through message → task → ACP → repo → card; dedup and non-owner DM block',async()=>{
  const t=await setup();await t.gateway.message(t.msg('denied','edit','ou_member'));expect(t.store.db.prepare('SELECT COUNT(*) n FROM tasks').get()).toEqual({n:0});
  await t.gateway.message(t.msg('m1','edit'));await t.wait('COMPLETED');expect(await readFile(join(t.repo,'fake-created.txt'),'utf8')).toBe('changed');
  await t.gateway.message(t.msg('m1','edit'));expect(t.store.db.prepare('SELECT COUNT(*) n FROM tasks').get()).toEqual({n:1});
  expect(JSON.stringify(t.sent)).toContain('COMPLETED');expect(JSON.stringify(t.sent)).not.toContain('HIDDEN_THOUGHT');
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
