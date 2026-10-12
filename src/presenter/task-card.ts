import type { GatewayAgentEvent } from '../acp/event-normalizer.js';
import type { ChannelPort } from './reply.js';
import type { SendOptions } from '@larksuite/channel';
import { redact } from '../security/redactor.js';
export interface CardState {taskId:string;repo:string;agent:string;mode:string;status:string;current:string;text:string;files:Set<string>}
export function taskCard(s:CardState,group:boolean){
  const safe=(text:string)=>group?redact(text):text;
  return {config:{wide_screen_mode:true},header:{template:s.status==='COMPLETED'?'green':s.status==='FAILED'?'red':'blue',title:{tag:'plain_text',content:'🤖 Agent Task · '+s.status}},
    elements:[{tag:'markdown',content:safe('**Repo** '+s.repo+'  ·  **Agent** '+s.agent+'  ·  **Mode** '+s.mode+'\n**Current** '+s.current+'\n**Files** '+s.files.size+'\n'+[...s.files].join('\n'))},
      {tag:'markdown',content:safe(s.text.slice(-18000)||'等待 Agent...')},
      ...(['RECEIVED','RUNNING','WAITING_APPROVAL'].includes(s.status)?[{tag:'action',actions:[{tag:'button',text:{tag:'plain_text',content:'取消'},value:{kind:'cancel',taskId:s.taskId}}]}]:[])]};
}
export class TaskPresenter {
  private messageId?:string;private timer?:ReturnType<typeof setTimeout>;private pending=Promise.resolve();private last=0;
  constructor(private channel:ChannelPort,private chat:string,private opts:SendOptions,public state:CardState,private group:boolean){}
  async start(){this.messageId=(await this.channel.send(this.chat,{card:taskCard(this.state,this.group)},this.opts)).messageId}
  event(event:GatewayAgentEvent){
    if(event.type==='assistant_delta')this.state.text+=event.text;
    else if(event.type==='file_change')event.paths.forEach(p=>this.state.files.add(p));
    else if(event.type==='status')this.state.current=event.text;
    else if(event.type==='tool_start'||event.type==='tool_end')this.state.current=event.name;
    else if(event.type==='terminal')this.state.current=event.summary;
    else if(event.type==='plan')this.state.current=event.items.join('\n');
    this.schedule();
  }
  schedule(){if(!this.timer)this.timer=setTimeout(()=>{this.timer=undefined;void this.flush().catch(()=>{})},Math.max(0,1000-(Date.now()-this.last)))}
  async flush(){
    this.pending=this.pending.catch(()=>{}).then(async()=>{if(this.messageId){await this.channel.updateCard(this.messageId,taskCard(this.state,this.group));this.last=Date.now()}});
    return this.pending;
  }
  async finish(status:string,error?:string){if(this.timer)clearTimeout(this.timer);this.timer=undefined;this.state.status=status;if(error)this.state.text='任务结束：'+error;await this.flush()}
}
