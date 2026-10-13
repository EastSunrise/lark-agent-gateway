import { Readable, Writable } from 'node:stream';
import { ClientSideConnection,ndJsonStream,PROTOCOL_VERSION,type InitializeResponse,type RequestPermissionRequest,type RequestPermissionResponse,type SessionNotification } from '@agentclientprotocol/sdk';
import { spawnAgent,stopProcess,type Launch } from './process-manager.js';
import { validateCapabilities } from './capabilities.js';
export function timeout<T>(promise:Promise<T>,ms:number,label:string):Promise<T>{
  let timer:ReturnType<typeof setTimeout>;
  return Promise.race([promise,new Promise<T>((_,reject)=>{timer=setTimeout(()=>reject(new Error(label+' timed out')),ms);timer.unref()})]).finally(()=>clearTimeout(timer));
}
export class AcpClient {
  private child; private connection:ClientSideConnection;
  info?:InitializeResponse; sessionId?:string; resumed=false;
  onEvent:(event:SessionNotification)=>void=()=>{};
  onPermission:(request:RequestPermissionRequest)=>Promise<RequestPermissionResponse>=async()=>({outcome:{outcome:'cancelled'}});
  private broken?:Error; private closing=false;
  constructor(launch:Launch){
    this.child=spawnAgent(launch);
    this.child.stderr.on('data',()=>{}); // drain, do not log sensitive adapter output
    this.child.on('error',e=>{this.broken=e;this.child.stdout.destroy()});
    this.child.on('exit',(code)=>{if(!this.closing)this.broken=new Error('Agent process exited: '+code);this.child.stdout.destroy()});
    this.connection=new ClientSideConnection(()=>({
      sessionUpdate:event=>{if(event.sessionId===this.sessionId)this.onEvent(event)},
      requestPermission:request=>request.sessionId===this.sessionId?this.onPermission(request):Promise.resolve({outcome:{outcome:'cancelled'}}),
    }),ndJsonStream(Writable.toWeb(this.child.stdin),Readable.toWeb(this.child.stdout) as ReadableStream<Uint8Array>));
  }
  async initialize(){
    this.info=await timeout(this.connection.initialize({protocolVersion:PROTOCOL_VERSION,clientInfo:{name:'lark-agent-gateway',version:'0.1.0'},clientCapabilities:{fs:{readTextFile:false,writeTextFile:false},terminal:false}}),30000,'ACP initialize');
    validateCapabilities(this.info);return this.info;
  }
  async open(cwd:string,profile:string,previous?:string){
    this.resumed=false;
    if(!this.info)await this.initialize();
    if(previous&&this.info?.agentCapabilities?.loadSession){
      this.sessionId=previous;
      try{
        const loaded=await timeout(this.connection.loadSession({sessionId:previous,cwd,mcpServers:[]}),30000,'ACP load');
        const mode=profile==='group-read'?'read-only':'workspace-write';
        if(loaded.modes?.currentModeId!==mode)throw new Error('Loaded Agent mode differs from required profile');
        this.resumed=true;return previous;
      }catch{this.sessionId=undefined}
    }
    const result=await timeout(this.connection.newSession({cwd,mcpServers:[]}),30000,'ACP session/new');
    this.sessionId=result.sessionId;
    const mode=profile==='group-read'?'read-only':'workspace-write';
    if(result.modes?.currentModeId!==mode)throw new Error('Agent did not start in required mode: '+mode);
    return result.sessionId;
  }
  async prompt(text:string){
    if(this.broken)throw this.broken;if(!this.sessionId)throw new Error('No ACP session');
    return timeout(this.connection.prompt({sessionId:this.sessionId,prompt:[{type:'text',text}]}),3600000,'ACP prompt');
  }
  async cancel(){if(this.sessionId)await timeout(this.connection.cancel({sessionId:this.sessionId}),5000,'ACP cancel').catch(()=>{})}
  alive(){return !this.broken&&!this.closing&&!this.connection.signal.aborted}
  async close(){this.closing=true;await stopProcess(this.child);this.child.stdout.destroy()}
}
