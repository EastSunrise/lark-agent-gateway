import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { execa } from 'execa';
import { loadConfig,stateDirectory,privateDirectory } from '../src/config/load.js';
import { openDatabase } from '../src/storage/database.js';
import { RepoRegistry } from '../src/repos/registry.js';
import { RepoViewManager } from '../src/repos/repo-view-manager.js';
import { AcpClient,timeout } from '../src/acp/client.js';
import { launchCodex,adapterEntry } from '../src/agents/codex/launcher.js';
import { securityProbe } from '../src/agents/codex/security.js';
import { connectChannel } from '../src/channel/lark-channel.js';
let failed=false;
async function check(name:string,fn:()=>Promise<unknown>|unknown){try{const result=await fn();console.log('PASS '+name+(typeof result==='string'?' · '+result:''));return result}catch(e){failed=true;console.log('FAIL '+name+' · '+(e instanceof Error?e.message:'error'));return undefined}}
await check('Node version',()=>{if(Number(process.versions.node.split('.')[0])<22)throw new Error('Node >=22 required');return process.version});
const config=loadConfig();console.log('PASS Config schema');const stateDir=stateDirectory(config);
await check('State directory',()=>privateDirectory(stateDir));
await check('SQLite',()=>{const db=openDatabase(stateDir);db.prepare('SELECT 1').get();db.close()});
await check('Git',async()=>(await execa('git',['--version'])).stdout);
const registry=new RepoRegistry();await check('Repo existence / canonical Git roots',()=>registry.initialize(config));
await check('Feishu credentials',()=>{if(!process.env.LARK_APP_ID||!process.env.LARK_APP_SECRET)throw new Error('Missing .env.local credentials')});
await check('codex-acp executable',()=>adapterEntry());
const repo=registry.list()[0];
if(repo){
  const view=await new RepoViewManager(registry,stateDir).getOwnerView(repo.id);
  const client=new AcpClient(launchCodex(config,repo.defaultAgent,'owner-write',view,stateDir,'doctor'));
  try{
    await check('ACP stable v1 initialize / modes',async()=>{const info=await client.initialize();return info.agentInfo?.name??'ACP v1'});
    await check('Codex authentication / workspace-write session',()=>client.open(view.cwd,'owner-write'));
  }finally{await client.close()}
}else{failed=true;console.log('FAIL No registered Git Repo')}
const report=await securityProbe(config,stateDir);
writeFileSync(join(stateDir,'security-report.json'),JSON.stringify(report,null,2),{mode:0o600});
console.log((report.passed?'PASS':'FAIL')+' Group Read Security Probe · '+report.reason);
for(const [name,pass] of Object.entries(report.checks))console.log((pass?'PASS':'FAIL')+' '+name);
if(!report.passed)failed=true;
if(process.argv.includes('--connect')){
  await check('Feishu WebSocket handshake',async()=>{const channel=connectChannel();try{await timeout(channel.connect(),20000,'Feishu connect');return 'connected'}finally{await channel.disconnect()}});
}
process.exitCode=failed?1:0;
