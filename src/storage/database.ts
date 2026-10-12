import Database from 'better-sqlite3';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { privateDirectory } from '../config/load.js';
import {protectPath} from '../security/private-path.js';
export function openDatabase(stateDir:string) {
  privateDirectory(stateDir);
  const db = new Database(join(stateDir,'state.db'));
  db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON'); db.pragma('busy_timeout = 5000');
  const local = new URL('./migrations/0001.sql',import.meta.url);
  const source = new URL('../../../src/storage/migrations/0001.sql',import.meta.url);
  db.exec(readFileSync(existsSync(local)?local:source,'utf8'));
  protectPath(join(stateDir,'state.db'),false);
  return db;
}
export type DB = ReturnType<typeof openDatabase>;
