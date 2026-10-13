import { nanoid } from 'nanoid';
import type { Store,Conversation } from '../storage/repositories.js';
import type {Profile} from '../policy/policy-engine.js';
import {redact} from '../security/redactor.js';
export function conversationKey(chat:string,dm:boolean,thread:string,repo:string,agent:string){return JSON.stringify([dm?'dm':'group',chat,dm?'':thread,repo,agent])}
export class ConversationManager{
  constructor(private store:Store){}
  findOrCreate(chat:string,dm:boolean,thread:string,repo:string,agent:string){
    const key=conversationKey(chat,dm,thread,repo,agent);
    const found=this.store.db.prepare('SELECT * FROM conversations WHERE lookup_key=? AND active=1 ORDER BY created_at DESC LIMIT 1').get(key) as Conversation|undefined;
    if(found)return found;
    const id=nanoid();const now=Date.now();
    this.store.db.prepare('INSERT INTO conversations(id,lookup_key,chat_id,thread_key,repo_id,agent_name,created_at,last_active_at) VALUES(?,?,?,?,?,?,?,?)').run(id,key,chat,dm?null:thread,repo,agent,now,now);
    return this.store.conversation(id);
  }
  reset(id:string){this.store.db.prepare('UPDATE conversations SET active=0 WHERE id=?').run(id)}
  context(id:string,profile:Profile){
    const conv=this.store.conversation(id);
    const read=(this.store.db.prepare('SELECT summary FROM conversation_summaries WHERE conversation_id=? AND profile=?').get(id,'group-read') as {summary:string}|undefined)?.summary??(conv.thread_key===null?'':conv.summary);
    if(profile==='group-read')return read;
    const write=(this.store.db.prepare('SELECT summary FROM conversation_summaries WHERE conversation_id=? AND profile=?').get(id,'owner-write') as {summary:string}|undefined)?.summary??(conv.thread_key===null?conv.summary:'');
    return [read,write].filter(Boolean).join('\n').slice(-24000);
  }
  append(id:string,input:string,output:string,profile:Profile='group-read'){
    const old=(this.store.db.prepare('SELECT summary FROM conversation_summaries WHERE conversation_id=? AND profile=?').get(id,profile) as {summary:string}|undefined)?.summary??'';
    // Public conversation text only; no private model reasoning.
    const summary=redact(old+'\nUser: '+input+'\nAssistant: '+output).slice(-24000);
    this.store.db.prepare('INSERT INTO conversation_summaries VALUES(?,?,?) ON CONFLICT(conversation_id,profile) DO UPDATE SET summary=excluded.summary').run(id,profile,summary);
    if(profile==='group-read'||this.store.conversation(id).thread_key===null)this.store.db.prepare('UPDATE conversations SET summary=?,last_active_at=? WHERE id=?').run(summary,Date.now(),id);
  }
}
