import {it,expect,afterEach} from 'vitest';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execa} from 'execa';
import {configSchema} from '../../src/config/schema.js';
import {openDatabase} from '../../src/storage/database.js';
import {Store} from '../../src/storage/repositories.js';
import {RepoRegistry} from '../../src/repos/registry.js';
import {DefaultRepoService} from '../../src/repos/default-repo-service.js';
const dbs:ReturnType<typeof openDatabase>[]=[];
afterEach(()=>dbs.splice(0).forEach(db=>db.close()));
async function setup(groupScope='group'){
  await mkdir('.test-tmp',{recursive:true});const root=await mkdtemp(resolve('.test-tmp/default-'));
  const config=configSchema.parse({repoDefaults:{groupScope},repos:{}});
  const db=openDatabase(join(root,'state'));dbs.push(db);const store=new Store(db);const registry=new RepoRegistry();await registry.initialize(config);
  return {root,config,store,registry,service:new DefaultRepoService(config,store,registry,join(root,'state'))};
}
it('creates one committed Git workspace per group, dedups concurrent first messages and restores on restart',async()=>{
  const t=await setup();const [a,b]=await Promise.all([t.service.ensure('oc_a',false),t.service.ensure('oc_a',false)]);
  expect(a.id).toBe(b.id);expect((await execa('git',['-C',a.path,'rev-parse','HEAD'])).stdout).toMatch(/^[a-f0-9]{40}$/);
  const other=await t.service.ensure('oc_b',false);expect(other.path).not.toBe(a.path);
  await writeFile(join(a.path,'keep.txt'),'dirty-owner-content');
  const registry=new RepoRegistry();await registry.initialize(t.config);
  const restarted=new DefaultRepoService(t.config,t.store,registry,join(t.root,'state'));await restarted.initialize();
  expect((await restarted.ensure('oc_a',false)).path).toBe(a.path);
  expect(await readFile(join(a.path,'keep.txt'),'utf8')).toBe('dirty-owner-content');
  expect(t.store.db.prepare('SELECT count(*) n FROM managed_repos').get()).toEqual({n:2});
});
it('never allows scope strings to become filesystem paths and keeps DM independent',async()=>{
  const t=await setup();const repo=await t.service.ensure('../../outside',false);
  expect(repo.path.startsWith(join(t.root,'state','repos'))).toBe(true);expect(repo.id).toMatch(/^auto-group-[a-f0-9]{20}$/);
  const dm=await t.service.ensure('../../outside',true);expect(dm.path).not.toBe(repo.path);
});
it('optional shared default maps different groups to the same Repo',async()=>{
  const t=await setup('shared');expect((await t.service.ensure('oc_a',false)).id).toBe((await t.service.ensure('oc_b',false)).id);
});
it('recovers a published Repo after database registration failure and preserves user edits across restart',async()=>{
  const t=await setup();
  t.store.db.exec("CREATE TRIGGER fail_registration BEFORE INSERT ON managed_repos BEGIN SELECT RAISE(ABORT,'REGISTRATION_FAILED'); END");
  await expect(t.service.ensure('oc_recover',false)).rejects.toThrow(/REGISTRATION_FAILED/);
  const pending=t.store.db.prepare('SELECT * FROM repo_creations').get() as {path:string;status:string};
  expect(pending.status).toBe('PUBLISHED');
  await writeFile(join(pending.path,'user-change.txt'),'keep this change');
  t.store.db.exec('DROP TRIGGER fail_registration');
  const registry=new RepoRegistry();await registry.initialize(t.config);
  const recovered=new DefaultRepoService(t.config,t.store,registry,join(t.root,'state'));await recovered.initialize();
  const repo=await recovered.ensure('oc_recover',false);
  expect(repo.path).toBe(pending.path);expect(await readFile(join(repo.path,'user-change.txt'),'utf8')).toBe('keep this change');
  expect(t.store.db.prepare('SELECT count(*) n FROM repo_creations').get()).toEqual({n:0});
});
it('retry in the same process completes failed registration without a false configured-Repo collision',async()=>{
  const t=await setup();t.store.db.exec("CREATE TRIGGER fail_registration BEFORE INSERT ON managed_repos BEGIN SELECT RAISE(ABORT,'FAIL'); END");
  await expect(t.service.ensure('oc_retry',false)).rejects.toThrow();
  t.store.db.exec('DROP TRIGGER fail_registration');
  expect((await t.service.ensure('oc_retry',false)).id).toMatch(/^auto-group-/);
  expect(t.store.db.prepare('SELECT count(*) n FROM managed_repos').get()).toEqual({n:1});
});
