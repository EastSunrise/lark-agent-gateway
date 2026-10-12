import {execa} from 'execa';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
export async function changes(cwd:string){
  const tracked=(await execa('git',['-C',cwd,'diff','HEAD','--name-only','-z'])).stdout.split('\0').filter(Boolean);
  const untracked=(await execa('git',['-C',cwd,'ls-files','--others','--exclude-standard','-z'])).stdout.split('\0').filter(Boolean);
  const result=new Map<string,string>();
  for(const path of new Set([...tracked,...untracked])){
    const bytes=await readFile(join(cwd,path)).catch(()=>null);
    result.set(path,bytes?createHash('sha256').update(bytes).digest('hex'):'deleted');
  }
  return result;
}
