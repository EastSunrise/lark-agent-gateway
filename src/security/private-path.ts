import {chmodSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
let sid:string|undefined;
export function protectPath(path:string,directory:boolean){
  if(process.platform!=='win32'){chmodSync(path,directory?0o700:0o600);return}
  if(!sid){
    const who=spawnSync('whoami',['/user','/fo','csv','/nh'],{encoding:'utf8',windowsHide:true});
    sid=who.stdout?.match(/S-1-5-[0-9-]+/)?.[0];
    if(!sid)throw new Error('Cannot resolve current Windows SID for private state ACL');
  }
  const permissions='*'+sid+':'+(directory?'(OI)(CI)F':'F');
  const result=spawnSync('icacls',[path,'/inheritance:r','/grant:r',permissions],{encoding:'utf8',windowsHide:true});
  if(result.status!==0)throw new Error('Cannot secure private state ACL: '+path);
}
