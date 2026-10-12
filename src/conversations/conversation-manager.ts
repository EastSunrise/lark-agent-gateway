import { nanoid } from 'nanoid';
import type { Store,Conversation } from '../storage/repositories.js';
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
  append(id:string,input:string,output:string){
    const old=this.store.conversation(id).summary;
    // Public conversation text only; no private model reasoning.
    const summary=(old+'\nUser: '+input+'\nAssistant: '+output).slice(-24000);
    this.store.db.prepare('UPDATE conversations SET summary=?,last_active_at=? WHERE id=?').run(summary,Date.now(),id);
  }
}
