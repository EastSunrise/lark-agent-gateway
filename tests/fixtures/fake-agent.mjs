import {AgentSideConnection,ndJsonStream,PROTOCOL_VERSION,RequestError} from '@agentclientprotocol/sdk';
import {Readable,Writable} from 'node:stream';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
let cancelled=false;let cwd;const mode=process.env.INITIAL_AGENT_MODE??'workspace-write';
const conn=new AgentSideConnection(connection=>({
  initialize:async()=>({protocolVersion:PROTOCOL_VERSION,agentCapabilities:{loadSession:true},agentInfo:{name:'fake',version:'1'}}),
  authenticate:async()=>({}),
  newSession:async p=>{cwd=p.cwd;return {sessionId:'fake-'+Date.now(),modes:{currentModeId:mode,availableModes:[{id:mode,name:mode}]}}},
  loadSession:async p=>{cwd=p.cwd;return {modes:{currentModeId:mode,availableModes:[{id:mode,name:mode}]}}},
  cancel:async()=>{cancelled=true},
  prompt:async p=>{
    cancelled=false;const text=p.prompt.map(x=>x.text??'').join('');
    if(text==='crash')process.exit(7);
    if(text==='error')throw new Error('fake error');
    await connection.sessionUpdate({sessionId:p.sessionId,update:{sessionUpdate:'agent_thought_chunk',content:{type:'text',text:'HIDDEN_THOUGHT_DO_NOT_STORE'}}});
    await connection.sessionUpdate({sessionId:p.sessionId,update:{sessionUpdate:'plan',entries:[{content:'inspect',priority:'medium',status:'in_progress'}]}});
    if(text.includes('permission')){
      const response=await connection.requestPermission({sessionId:p.sessionId,toolCall:{toolCallId:'t1',title:'Network request',kind:'execute',status:'pending'},options:[{optionId:'yes',name:'Allow once',kind:'allow_once'},{optionId:'no',name:'Reject',kind:'reject_once'},{optionId:'forever',name:'Always',kind:'allow_always'}]});
      await connection.sessionUpdate({sessionId:p.sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:JSON.stringify(response)}}});
    }
    if(text.includes('wait')){for(let i=0;i<200&&!cancelled;i++)await new Promise(r=>setTimeout(r,20))}
    if(text.includes('edit')&&mode==='workspace-write'){
      await writeFile(join(cwd,'fake-created.txt'),'changed');
      await connection.sessionUpdate({sessionId:p.sessionId,update:{sessionUpdate:'tool_call',toolCallId:'edit',title:'Edit file',kind:'edit',status:'completed',locations:[{path:join(cwd,'fake-created.txt')}]}});
    }
    if(!cancelled)await connection.sessionUpdate({sessionId:p.sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'answer:'+text}}});
    return {stopReason:cancelled?'cancelled':'end_turn'};
  }
}),ndJsonStream(Writable.toWeb(process.stdout),Readable.toWeb(process.stdin)));
await conn.closed;
