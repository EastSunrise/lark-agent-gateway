import {createHash} from 'node:crypto';
import {join,resolve,isAbsolute,relative} from 'node:path';
import {mkdtemp,writeFile,readFile,rename,realpath,lstat,rm} from 'node:fs/promises';
import {execa} from 'execa';
import {nanoid} from 'nanoid';
import type {Config} from '../config/schema.js';
import type {Store} from '../storage/repositories.js';
import type {RepoRegistry,Repo} from './registry.js';
import {privateDirectory} from '../config/load.js';
import {KeyedLock} from './repo-lock.js';
interface ManagedRepo {repo_id:string;scope_type:string;scope_key:string;path:string;default_agent:string}
interface Creation extends ManagedRepo {staging_path:string;root:string;token:string;status:string;created_at:number}
export class DefaultRepoService{
  private lock=new KeyedLock();
  constructor(private config:Config,private store:Store,private registry:RepoRegistry,private stateDir:string){}
  async initialize(){
    for(const row of this.store.db.prepare('SELECT * FROM managed_repos').all() as ManagedRepo[])await this.registry.register(row.repo_id,{path:row.path,defaultAgent:row.default_agent},this.config);
    for(const row of this.store.db.prepare("SELECT * FROM repo_creations WHERE status IN ('READY','PUBLISHED')").all() as Creation[])await this.publish(row);
  }
  private async exists(path:string){return !!(await lstat(path).catch(e=>{if(e.code==='ENOENT')return null;throw e}))}
  private async verify(row:Creation,path:string){
    const rel=relative(row.root,resolve(path));
    if(!rel||rel.startsWith('..')||isAbsolute(rel)||(await lstat(path)).isSymbolicLink())throw new Error('Unsafe managed Repo recovery path');
    const actual=await realpath(path);const actualRel=relative(row.root,actual);
    if(!actualRel||actualRel.startsWith('..')||isAbsolute(actualRel))throw new Error('Managed Repo escaped its creation root');
    const marker=JSON.parse(await readFile(join(path,'.git','gateway-managed.json'),'utf8'));
    if(marker.repoId!==row.repo_id||marker.token!==row.token)throw new Error('Existing target is not this Gateway creation; refusing to overwrite');
  }
  private async prepare(row:Creation){
    // Preserve any staging directory left by a previous crash; never overwrite it.
    const staging=await mkdtemp(join(row.root,'.creating-'));
    this.store.db.prepare('UPDATE repo_creations SET staging_path=? WHERE repo_id=?').run(staging,row.repo_id);row.staging_path=staging;
    try{
      await execa('git',['-c','init.templateDir=','init','--template=','--initial-branch=main',staging]);
      await writeFile(join(staging,'README.md'),'# '+row.repo_id+'\n\nWorkspace created by lark-agent-gateway.\n',{flag:'wx'});
      await writeFile(join(staging,'.gitignore'),'.env\n.env.*\nnode_modules/\n',{flag:'wx'});
      await writeFile(join(staging,'.git','gateway-managed.json'),JSON.stringify({repoId:row.repo_id,token:row.token}),{flag:'wx',mode:0o600});
      await execa('git',['-C',staging,'add','README.md','.gitignore']);
      await execa('git',['-C',staging,'-c','core.hooksPath='+join(staging,'.git','hooks'),'-c','user.name=Gateway','-c','user.email=gateway@localhost','-c','commit.gpgsign=false','commit','-m','Initialize Gateway workspace']);
      this.store.db.prepare("UPDATE repo_creations SET status='READY' WHERE repo_id=?").run(row.repo_id);row.status='READY';
    }catch(e){
      const rel=relative(row.root,resolve(staging));
      if(rel&&!rel.startsWith('..')&&!isAbsolute(rel))await rm(staging,{recursive:true,force:true});
      throw e;
    }
  }
  private async publish(row:Creation):Promise<Repo>{
    if(!this.config.agents[row.default_agent]?.enabled)throw new Error('Managed Repo Agent unavailable');
    if(await this.exists(row.path))await this.verify(row,row.path);
    else{
      if(row.status==='PUBLISHED')throw new Error('Published managed Repo missing; refusing to recreate user workspace');
      await this.verify(row,row.staging_path);await rename(row.staging_path,row.path);
    }
    this.store.db.prepare("UPDATE repo_creations SET status='PUBLISHED' WHERE repo_id=?").run(row.repo_id);
    // A failed transaction leaves a durable token and the published directory.
    // Retry/restart completes registration without rebuilding or deleting it.
    this.store.db.transaction(()=>{
      this.store.db.prepare('INSERT INTO managed_repos VALUES(?,?,?,?,?,?)').run(row.repo_id,row.scope_type,row.scope_key,row.path,row.default_agent,row.created_at);
      this.store.db.prepare('DELETE FROM repo_creations WHERE repo_id=?').run(row.repo_id);
    })();
    await this.registry.register(row.repo_id,{path:row.path,defaultAgent:row.default_agent},this.config);
    return this.registry.get(row.repo_id);
  }
  async ensure(chatId:string,dm:boolean):Promise<Repo>{
    if(!this.config.repoDefaults.enabled)throw new Error('Default Repo creation disabled');
    const type=dm?'dm':'group';const scope=dm?chatId:this.config.repoDefaults.groupScope==='shared'?'shared':chatId;
    return this.lock.run(JSON.stringify([type,scope]),async()=>{
      const existing=this.store.db.prepare('SELECT * FROM managed_repos WHERE scope_type=? AND scope_key=?').get(type,scope) as ManagedRepo|undefined;
      if(existing){await this.registry.register(existing.repo_id,{path:existing.path,defaultAgent:existing.default_agent},this.config);return this.registry.get(existing.repo_id)}
      let row=this.store.db.prepare('SELECT * FROM repo_creations WHERE scope_type=? AND scope_key=?').get(type,scope) as Creation|undefined;
      if(!row){
        const agent=this.config.repoDefaults.defaultAgent;
        if(!this.config.agents[agent]?.enabled)throw new Error('Default Repo Agent unavailable: '+agent);
        const configuredRoot=this.config.repoDefaults.root??join(this.stateDir,'repos');
        if(!isAbsolute(configuredRoot)||configuredRoot.split(/[\\/]/).includes('..'))throw new Error('repoDefaults.root must be an absolute path without ..');
        privateDirectory(configuredRoot);const root=await realpath(configuredRoot);
        const id='auto-'+type+'-'+createHash('sha256').update(scope).digest('hex').slice(0,20);
        if(this.registry.list().some(r=>r.id===id))throw new Error('Default Repo id conflicts with configured Repo');
        const target=join(root,id);
        if(await this.exists(target))throw new Error('Default Repo target already exists without a creation record; refusing to overwrite');
        row={repo_id:id,scope_type:type,scope_key:scope,path:target,staging_path:'',root,token:nanoid(32),default_agent:agent,status:'CREATING',created_at:Date.now()};
        this.store.db.prepare('INSERT INTO repo_creations VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,type,scope,target,'',root,row.token,agent,row.status,row.created_at);
      }
      if(row.status==='CREATING')await this.prepare(row);
      return this.publish(row);
    });
  }
}
