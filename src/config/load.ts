import { readFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { parseEnv } from 'node:util';
import { parse } from 'yaml';
import { configSchema, type Config } from './schema.js';
export function loadEnv(path = resolve('.env.local')) {
  if (!existsSync(path)) return;
  const vars = process.env;
  for (const [key,value] of Object.entries(parseEnv(readFileSync(path,'utf8')))) vars[key] ??= value;
}
export function loadConfig(path = process.env.GATEWAY_CONFIG ?? resolve('config/config.yaml')): Config {
  loadEnv();
  return configSchema.parse(parse(readFileSync(path,'utf8')));
}
export function stateDirectory(config: Config) {
  return resolve(config.runtime.stateDir ?? process.env.GATEWAY_STATE_DIR ?? join(homedir(),'.lark-agent-gateway'));
}
export function privateDirectory(path:string) {
  mkdirSync(path,{recursive:true,mode:0o700});
  if(process.platform!=='win32') chmodSync(path,0o700);
}
