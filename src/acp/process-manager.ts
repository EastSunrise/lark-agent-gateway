import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { execa } from 'execa';
export interface Launch {command:string;args:string[];cwd:string;env:NodeJS.ProcessEnv}
export function spawnAgent(launch:Launch){
  return spawn(launch.command,launch.args,{cwd:launch.cwd,env:launch.env,stdio:['pipe','pipe','pipe'],windowsHide:true,shell:false});
}
export async function stopProcess(child:ChildProcessWithoutNullStreams){
  child.stdin.end();
  if(child.exitCode!==null)return;
  const done=new Promise<void>(r=>child.once('exit',()=>r()));
  await Promise.race([done,new Promise<void>(r=>setTimeout(r,1500))]);
  if(child.exitCode===null){
    if(process.platform==='win32'&&child.pid)await execa('taskkill',['/pid',String(child.pid),'/t','/f'],{reject:false,windowsHide:true});
    else child.kill('SIGTERM');
  }
}
