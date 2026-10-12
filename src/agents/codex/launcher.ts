import { createRequire } from 'node:module';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, copyFileSync, writeFileSync } from 'node:fs';
import { privateDirectory } from '../../config/load.js';
import type { Config } from '../../config/schema.js';
import type { Profile } from '../../policy/policy-engine.js';
import type { RepoView } from '../../repos/repo-view-manager.js';
import type { Launch } from '../../acp/process-manager.js';
import { codexConfig } from './profiles.js';
import {protectPath} from '../../security/private-path.js';
const require=createRequire(import.meta.url);
export function adapterEntry(){return require.resolve('@agentclientprotocol/codex-acp')}
export function launchCodex(config:Config,agent:string,profile:Profile,view:RepoView,stateDir:string,sessionId:string):Launch{
  const spec=config.agents[agent];if(!spec?.enabled)throw new Error('Disabled Agent');
  const env:NodeJS.ProcessEnv={};
  // Never give the child Feishu credentials or arbitrary application secrets.
  for(const key of ['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','COMSPEC','PATHEXT','TEMP','TMP','TMPDIR','HOME','USERPROFILE','APPDATA','LOCALAPPDATA','LANG','LC_ALL','HTTPS_PROXY','HTTP_PROXY','ALL_PROXY','NO_PROXY','CODEX_HOME','CODEX_PATH','CODEX_API_KEY','OPENAI_API_KEY','MODEL_PROVIDER'])if(process.env[key])env[key]=process.env[key];
  env.INITIAL_AGENT_MODE=profile==='group-read'?'read-only':'workspace-write';
  env.NO_BROWSER='1';
  const cfg=codexConfig(profile,view,config.security.groupRead.deny);
  if(profile==='group-read'){
    const home=join(stateDir,'runtime',sessionId);privateDirectory(home);
    const source=join(process.env.CODEX_HOME??join(homedir(),'.codex'),'auth.json');
    if(existsSync(source)){copyFileSync(source,join(home,'auth.json'));protectPath(join(home,'auth.json'),false)}
    writeFileSync(join(home,'config.toml'),'# Gateway isolated configuration\n',{mode:0o600});
    env.CODEX_HOME=home;
  }
  // Adapter logs can contain prompts/reasoning. Do not enable APP_SERVER_LOGS.
  env.CODEX_CONFIG=JSON.stringify(cfg);
  if(spec.command==='codex-acp')return {command:process.execPath,args:[adapterEntry(),...spec.args],cwd:view.cwd,env};
  return {command:spec.command,args:spec.args,cwd:view.cwd,env};
}
