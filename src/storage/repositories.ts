import type { DB } from './database.js';
export interface Conversation {id:string;lookup_key:string;chat_id:string;thread_key:string|null;repo_id:string;agent_name:string;repo_revision:string|null;view_json:string|null;summary:string;active:number;last_active_at:number}
export interface Task {id:string;conversation_id:string;agent_session_id:string|null;requester_id:string;input_message_id:string;input_text:string;chat_type:'p2p'|'group';status:string}
export class Store {
  constructor(public db:DB){}
  dedup(id:string) {return this.db.prepare('INSERT OR IGNORE INTO processed_messages VALUES(?,?)').run(id,Date.now()).changes===1}
  binding(chat:string){return this.db.prepare('SELECT * FROM chat_bindings WHERE chat_id=?').get(chat) as {repo_id:string;default_agent:string}|undefined}
  bind(chat:string,repo:string,agent:string,owner:string){this.db.prepare('INSERT OR REPLACE INTO chat_bindings VALUES(?,?,?,?,?)').run(chat,repo,agent,owner,Date.now())}
  preference(chat:string){return this.db.prepare('SELECT * FROM preferences WHERE chat_id=?').get(chat) as {repo_id:string|null;agent_name:string|null}|undefined}
  prefer(chat:string,repo:string|null,agent:string|null){this.db.prepare('INSERT INTO preferences VALUES(?,?,?) ON CONFLICT(chat_id) DO UPDATE SET repo_id=COALESCE(excluded.repo_id,repo_id),agent_name=COALESCE(excluded.agent_name,agent_name)').run(chat,repo,agent)}
  task(id:string){return this.db.prepare('SELECT * FROM tasks WHERE id=?').get(id) as Task|undefined}
  conversation(id:string){return this.db.prepare('SELECT * FROM conversations WHERE id=?').get(id) as Conversation}
  recover(){
    this.db.transaction(()=>{
      this.db.prepare("UPDATE tasks SET status='INTERRUPTED',finished_at=? WHERE status IN ('RECEIVED','RUNNING','WAITING_APPROVAL')").run(Date.now());
      this.db.prepare("UPDATE approvals SET status='EXPIRED',decided_at=? WHERE status='PENDING'").run(Date.now());
      this.db.prepare("UPDATE agent_sessions SET status='INTERRUPTED' WHERE status='ACTIVE'").run();
    })();
  }
}
