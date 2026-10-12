import pino from 'pino';
import { join } from 'node:path';
import { privateDirectory } from '../config/load.js';
export function createAudit(stateDir:string){
  privateDirectory(join(stateDir,'logs'));
  return pino({level:'info',redact:['credential','prompt','response','reasoning','payload','appSecret']},pino.destination({dest:join(stateDir,'logs','gateway.log'),sync:true,mkdir:true}));
}
