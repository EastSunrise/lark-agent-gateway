import type { SessionNotification } from '@agentclientprotocol/sdk';
export type GatewayAgentEvent =
  |{type:'status';text:string}|{type:'plan';items:string[]}|{type:'tool_start';name:string}
  |{type:'tool_end';name:string;status:string}|{type:'file_change';paths:string[]}
  |{type:'terminal';summary:string}|{type:'assistant_delta';text:string}|{type:'permission';approvalId:string}
  |{type:'completed';summary:string}|{type:'error';message:string};
export function normalizeEvent({update:u}:SessionNotification):GatewayAgentEvent[]{
  if(u.sessionUpdate==='agent_thought_chunk')return [{type:'status',text:'正在分析...'}];
  if(u.sessionUpdate==='agent_message_chunk'&&u.content.type==='text')return [{type:'assistant_delta',text:u.content.text}];
  if(u.sessionUpdate==='plan')return [{type:'plan',items:u.entries.map(x=>x.status+': '+x.content)}];
  if(u.sessionUpdate==='tool_call'||u.sessionUpdate==='tool_call_update'){
    const out:GatewayAgentEvent[]=[];
    if(u.title)out.push(u.status==='completed'||u.status==='failed'?{type:'tool_end',name:u.title,status:u.status}:{type:'tool_start',name:u.title});
    const paths=u.locations?.map(x=>x.path)??[];
    if(paths.length&&u.kind==='edit')out.push({type:'file_change',paths});
    // Raw tool outputs may contain source/secrets. Only a status summary goes to UI.
    if(u.kind==='execute'&&u.status)out.push({type:'terminal',summary:(u.title??'Shell')+' · '+u.status});
    return out;
  }
  return [];
}
