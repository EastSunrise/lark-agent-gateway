import Database from 'better-sqlite3';
import { readFileSync, existsSync,readdirSync } from 'node:fs';
import { join } from 'node:path';
import { privateDirectory } from '../config/load.js';
import {protectPath} from '../security/private-path.js';
export function openDatabase(stateDir:string) {
  privateDirectory(stateDir);
  const db = new Database(join(stateDir,'state.db'));
  db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON'); db.pragma('busy_timeout = 5000');
  const local = new URL('./migrations/',import.meta.url);
  const source = new URL('../../../src/storage/migrations/',import.meta.url);
  const dir=existsSync(local)?local:source;
  for(const file of readdirSync(dir).filter(f=>/^\d+\.sql$/.test(f)).sort())db.exec(readFileSync(new URL(file,dir),'utf8'));
  protectPath(join(stateDir,'state.db'),false);
  return db;
}
export type DB = ReturnType<typeof openDatabase>;
