import {it,expect} from 'vitest';
import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execa} from 'execa';
import {configSchema} from '../../src/config/schema.js';
import {loadEnv} from '../../src/config/load.js';
import {AcpClient} from '../../src/acp/client.js';
import {launchCodex} from '../../src/agents/codex/launcher.js';
import {securityProbe} from '../../src/agents/codex/security.js';
it.skipIf(process.env.RUN_CODEX_E2E!=='1')('real Codex reads repo, writes file, runs verification, and group-read fails closed',async()=>{
  loadEnv();await mkdir('.test-tmp',{recursive:true});const root=await mkdtemp(resolve('.test-tmp/e2e-'));const repo=join(root,'repo');await mkdir(repo);
  await execa('git',['init',repo]);await writeFile(join(repo,'README.md'),'E2E_CANARY_READ_2026');
  await execa('git',['-C',repo,'add','README.md']);await execa('git',['-C',repo,'-c','user.name=Test','-c','user.email=test@localhost','commit','-m','fixture']);
  const config=configSchema.parse({repos:{e2e:{path:repo}}});
  const client=new AcpClient(launchCodex(config,'codex','owner-write',{repoId:'e2e',revision:'HEAD',cwd:repo,readRoots:[repo]},root,'e2e'));
  let text='';let fileChange=false;client.onEvent=({update:u})=>{if(u.sessionUpdate==='agent_message_chunk'&&u.content.type==='text')text+=u.content.text;if((u.sessionUpdate==='tool_call'||u.sessionUpdate==='tool_call_update')&&u.kind==='edit')fileChange=true};
  try{
    await client.initialize();await client.open(repo,'owner-write');
    await client.prompt('Read README.md and quote its single canary line. Create result.txt with exactly ACP_E2E_OK. Verify it by running a shell command. Only work in this temporary repository. Do not access network or files outside this directory.');
    expect(await readFile(join(repo,'result.txt'),'utf8')).toContain('ACP_E2E_OK');expect(text).toContain('E2E_CANARY_READ_2026');
  }finally{await client.close()}
  const report=await securityProbe(config,root);expect(report.passed).toBe(false);
},180000);
