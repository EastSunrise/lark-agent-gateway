import {describe,it,expect,afterEach} from 'vitest';
import {resolve,join} from 'node:path';
import {mkdtempSync} from 'node:fs';
import {openDatabase} from '../../src/storage/database.js';
import {Store} from '../../src/storage/repositories.js';
import {OwnerService} from '../../src/identity/owner-service.js';
import {policy} from '../../src/policy/policy-engine.js';
import {conversationKey,ConversationManager} from '../../src/conversations/conversation-manager.js';
import {transition} from '../../src/tasks/task-state.js';
import {parseCommand} from '../../src/commands/command-router.js';
import {redact} from '../../src/security/redactor.js';
import {normalizeEvent} from '../../src/acp/event-normalizer.js';
import {configSchema} from '../../src/config/schema.js';
import {KeyedLock,Semaphore} from '../../src/repos/repo-lock.js';
import {mkdirSync} from 'node:fs';
mkdirSync('.test-tmp',{recursive:true});
const databases:ReturnType<typeof openDatabase>[]=[];
function store(){const db=openDatabase(mkdtempSync(resolve('.test-tmp/unit-')));databases.push(db);return new Store(db)}
afterEach(()=>databases.splice(0).forEach(db=>db.close()));
describe('Identity and policy',()=>{
  it('one-time DM Owner claim and failed brute force',()=>{
    const s=store();const o=new OwnerService(s.db);const code=o.bootstrap()!;
    expect(o.claim('ou_a',code,false)).toBe(false);expect(o.claim('ou_a',code,true)).toBe(true);
    expect(o.isOwner('ou_a')).toBe(true);expect(o.claim('ou_b',code,true)).toBe(false);
    expect(()=>new OwnerService(s.db,'ou_b')).toThrow(/conflicts/);
  });
  it('enforces DM and mentioned bound group permissions',()=>{
    const base={owner:false,dm:false,mentioned:true,mentionAll:false,bound:true,groupSafe:true};
    expect(policy(base)).toBe('group-read');expect(policy({...base,owner:true})).toBe('owner-write');
    expect(policy({...base,dm:true})).toBe('DENY');expect(policy({...base,dm:true,owner:true})).toBe('owner-write');
    expect(policy({...base,mentioned:false})).toBe('IGNORE');expect(policy({...base,mentionAll:true})).toBe('IGNORE');
    expect(policy({...base,bound:false})).toBe('UNBOUND');expect(policy({...base,groupSafe:false})).toBe('UNSAFE');
  });
  it('binds only registered selection state and dedups across stores',()=>{
    const s=store();s.bind('chat','repo','codex','ou_a');expect(s.binding('chat')?.repo_id).toBe('repo');
    expect(s.dedup('m1')).toBe(true);expect(new Store(s.db).dedup('m1')).toBe(false);
  });
});
it('keys isolate threads, repos, agents and /new generations',()=>{
  expect(conversationKey('c',false,'t1','r','a')).not.toBe(conversationKey('c',false,'t2','r','a'));
  const s=store();const cm=new ConversationManager(s);const a=cm.findOrCreate('c',false,'t','r','a');
  expect(cm.findOrCreate('c',false,'t','r','a').id).toBe(a.id);cm.reset(a.id);
  expect(cm.findOrCreate('c',false,'t','r','a').id).not.toBe(a.id);
});
it('rejects task transitions out of terminal states',()=>{
  expect(transition('RUNNING','WAITING_APPROVAL')).toBe('WAITING_APPROVAL');
  expect(()=>transition('COMPLETED','RUNNING')).toThrow();expect(()=>transition('RECEIVED','COMPLETED')).toThrow();
});
it('parses control commands and leaves natural language intact',()=>{
  expect(parseCommand('/repo bind payment')).toEqual({name:'/repo',args:['bind','payment']});expect(parseCommand('fix bug')).toBeNull();
});
it('redacts keys, partial private keys, tokens and assignments',()=>{
  for(const text of ['Bearer abcdef','AWS=AKIAABCDEFGHIJKLMNOP','sk-abcdefghijklmno','secret=abc','-----BEGIN PRIVATE KEY-----\nabcdef']){
    expect(redact(text)).toContain('[REDACTED]');
  }
});
it('never emits private reasoning contents',()=>{
  expect(JSON.stringify(normalizeEvent({sessionId:'s',update:{sessionUpdate:'agent_thought_chunk',content:{type:'text',text:'private'}}}))).not.toContain('private');
});
it('schema rejects group mention bypass and network',()=>{
  expect(()=>configSchema.parse({repos:{},feishu:{requireMentionInGroup:false}})).toThrow();
  expect(()=>configSchema.parse({repos:{},security:{groupRead:{network:true}}})).toThrow();
});
it('serializes same keys and limits global concurrency',async()=>{
  const lock=new KeyedLock();let active=0;let peak=0;
  const work=()=>lock.run('r',async()=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,5));active--});
  await Promise.all([work(),work(),work()]);expect(peak).toBe(1);
  const sem=new Semaphore(2);peak=0;await Promise.all(Array.from({length:5},()=>sem.run(async()=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,5));active--})));expect(peak).toBe(2);
});
