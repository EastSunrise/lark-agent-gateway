import { nanoid } from 'nanoid';
import type { RequestPermissionRequest,RequestPermissionResponse } from '@agentclientprotocol/sdk';
import type { Store,Task } from '../storage/repositories.js';
import type { OwnerService } from '../identity/owner-service.js';
import type { ChannelPort } from '../presenter/reply.js';
import { approvalCard } from '../presenter/approval-card.js';
import { redact } from '../security/redactor.js';
const cancelled:RequestPermissionResponse={outcome:{outcome:'cancelled'}};
export class ApprovalManager{
  private waiting=new Map<string,{resolve:(r:RequestPermissionResponse)=>void;request:RequestPermissionRequest;timer:ReturnType<typeof setTimeout>;taskId:string}>();
  constructor(private store:Store,private owner:OwnerService,private channel:ChannelPort,private onState:(taskId:string,state:'WAITING_APPROVAL'|'RUNNING')=>void){}
  async request(task:Task,sessionId:string,profile:string,request:RequestPermissionRequest){
    if(profile!=='owner-write'||!this.owner.isOwner(task.requester_id))return cancelled;
    const allow=request.options.find(x=>x.kind==='allow_once');if(!allow)return cancelled;
    const id=nanoid();const now=Date.now();
    // Only the public permission subject/reason is retained. No raw tool payload/source.
    const payload={options:request.options.map(x=>({optionId:x.optionId,kind:x.kind})),subject:redact(request.toolCall.title??'Permission'),reason:'Agent requested additional capability'};
    this.store.db.prepare('INSERT INTO approvals(id,task_id,session_id,requester,payload_json,created_at,status,expires_at) VALUES(?,?,?,?,?,?,?,?)').run(id,task.id,sessionId,task.requester_id,JSON.stringify(payload),now,'PENDING',now+600000);
    this.onState(task.id,'WAITING_APPROVAL');
    const decision=new Promise<RequestPermissionResponse>(resolve=>{
      const timer=setTimeout(()=>this.settle(id,'EXPIRED'),600000);timer.unref();this.waiting.set(id,{resolve,request,timer,taskId:task.id});
    });
    try{
      const conv=this.store.conversation(task.conversation_id);
      // Approval is delivered privately to Owner so shared chats don't expose write context.
      const result=await this.channel.send(this.owner.id()!,{card:approvalCard(id,conv.repo_id,payload.subject,payload.reason)});
      this.store.db.prepare('UPDATE approvals SET card_message_id=? WHERE id=?').run(result.messageId,id);
    }catch{this.settle(id,'REJECTED')}
    return decision;
  }
  decide(id:string,actor:string,decision:string){
    if(!this.owner.isOwner(actor))return false;
    return this.settle(id,decision==='allow'?'APPROVED':'REJECTED',actor);
  }
  private settle(id:string,status:string,actor?:string){
    const pending=this.waiting.get(id);if(!pending)return false;
    const row=this.store.db.prepare('SELECT * FROM approvals WHERE id=?').get(id) as {expires_at:number;card_message_id:string;payload_json:string;task_id:string};
    if(Date.now()>row.expires_at)status='EXPIRED';
    const changed=this.store.db.prepare("UPDATE approvals SET status=?,decided_by=?,decided_at=? WHERE id=? AND status='PENDING'").run(status,actor??null,Date.now(),id).changes;
    if(!changed)return false;
    clearTimeout(pending.timer);this.waiting.delete(id);
    const option=status==='APPROVED'?pending.request.options.find(x=>x.kind==='allow_once'):pending.request.options.find(x=>x.kind==='reject_once');
    pending.resolve(option?{outcome:{outcome:'selected',optionId:option.optionId}}:cancelled);
    this.onState(pending.taskId,'RUNNING');
    const p=JSON.parse(row.payload_json);const conv=this.store.conversation(this.store.task(row.task_id)!.conversation_id);
    if(row.card_message_id)void this.channel.updateCard(row.card_message_id,approvalCard(id,conv.repo_id,p.subject,p.reason,status)).catch(()=>{});
    return true;
  }
  cancelTask(taskId:string){for(const [id,item] of this.waiting)if(item.taskId===taskId)this.settle(id,'CANCELLED')}
  close(){for(const id of this.waiting.keys())this.settle(id,'CANCELLED')}
}
