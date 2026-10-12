import { randomInt, timingSafeEqual } from 'node:crypto';
import type { DB } from '../storage/database.js';
export class OwnerService {
  private code?:string; private expires=0; private attempts=new Map<string,{count:number;since:number}>();
  constructor(private db:DB, configured?:string){
    const saved=this.id();
    if(configured && saved && saved!==configured) throw new Error('Configured Owner conflicts with persisted Owner; explicit migration required');
    if(configured&&!saved) db.prepare('INSERT INTO owner_identity VALUES(?,?)').run(configured,Date.now());
  }
  id(){return (this.db.prepare('SELECT open_id FROM owner_identity LIMIT 1').get() as {open_id:string}|undefined)?.open_id}
  isOwner(sender:string){return this.id()===sender}
  bootstrap(){if(this.id())return; this.code=String(randomInt(100000,1000000));this.expires=Date.now()+600000;return this.code}
  claim(sender:string,code:string,dm:boolean){
    if(!dm||this.id()||!this.code||Date.now()>this.expires)return false;
    const a=this.attempts.get(sender);const attempt=a&&Date.now()-a.since<600000?a:{count:0,since:Date.now()};this.attempts.set(sender,attempt);
    if(++attempt.count>5)return false;
    if(code.length!==this.code.length||!timingSafeEqual(Buffer.from(code),Buffer.from(this.code)))return false;
    this.db.prepare('INSERT INTO owner_identity VALUES(?,?)').run(sender,Date.now());this.code=undefined;return true;
  }
}
