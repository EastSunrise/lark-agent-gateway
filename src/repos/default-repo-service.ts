import {createHash} from 'node:crypto';
import {join,resolve,isAbsolute,relative} from 'node:path';
import {mkdir,mkdtemp,writeFile,rename,realpath,rm} from 'node:fs/promises';
import {execa} from 'execa';
import type {Config} from '../config/schema.js';
import type {Store} from '../storage/repositories.js';
import type {RepoRegistry,Repo} from './registry.js';
import {privateDirectory} from '../config/load.js';
import {KeyedLock} from './repo-lock.js';
interface ManagedRepo {repo_id:string;scope_type:string;scope_key:string;path:string;default_agent:string}
export class DefaultRepoService{
  private lock=new KeyedLock();
  constructor(private config:Config,private store:Store,private registry:RepoRegistry,private stateDir:string){}
  async initialize(){
    const records=this.store.db.prepare('SELECT * FROM managed_repos').all() as ManagedRepo[];
    for(const row of records)await this.registry.register(row.repo_id,{path:row.path,defaultAgent:row.default_agent},this.config);
  }
  async ensure(chatId:string,dm:boolean):Promise<Repo>{
    if(!this.config.repoDefaults.enabled)throw new Error('Default Repo creation disabled');
    const type=dm?'dm':'group';
    const scope=dm?chatId:this.config.repoDefaults.groupScope==='shared'?'shared':chatId;
    return this.lock.run(JSON.stringify([type,scope]),async()=>{
      const existing=this.store.db.prepare('SELECT * FROM managed_repos WHERE scope_type=? AND scope_key=?').get(type,scope) as ManagedRepo|undefined;
      if(existing)return this.registry.get(existing.repo_id);
      const agent=this.config.repoDefaults.defaultAgent;
      if(!this.config.agents[agent]?.enabled)throw new Error('Default Repo Agent unavailable: '+agent);
      const configuredRoot=this.config.repoDefaults.root??join(this.stateDir,'repos');
      if(!isAbsolute(configuredRoot)||configuredRoot.split(/[\\/]/).includes('..'))throw new Error('repoDefaults.root must be an absolute path without ..');
      privateDirectory(configuredRoot);const root=await realpath(configuredRoot);
      const id='auto-'+type+'-'+createHash('sha256').update(scope).digest('hex').slice(0,20);
      if(this.registry.list().some(r=>r.id===id))throw new Error('Default Repo id conflicts with configured Repo');
      const target=join(root,id);
      // Prepare in a new private staging directory, never modify a preexisting target.
      const staging=await mkdtemp(join(root,'.creating-'));
      try{
        await execa('git',['-c','init.templateDir=','init','--template=','--initial-branch=main',staging]);
        await writeFile(join(staging,'README.md'),'# '+id+'\n\nWorkspace created by lark-agent-gateway.\n',{flag:'wx'});
        await writeFile(join(staging,'.gitignore'),'.env\n.env.*\nnode_modules/\n',{flag:'wx'});
        await execa('git',['-C',staging,'add','README.md','.gitignore']);
        await execa('git',['-C',staging,'-c','core.hooksPath='+join(staging,'.git','hooks'),'-c','user.name=Gateway','-c','user.email=gateway@localhost','-c','commit.gpgsign=false','commit','-m','Initialize Gateway workspace']);
        await rename(staging,target);
      }catch(e){
        // Only remove the staging directory we just created inside the verified root.
        const rel=relative(root,resolve(staging));
        if(rel&&!rel.startsWith('..')&&!isAbsolute(rel))await rm(staging,{recursive:true,force:true});
        throw e;
      }
      await this.registry.register(id,{path:target,defaultAgent:agent},this.config);
      this.store.db.prepare('INSERT INTO managed_repos VALUES(?,?,?,?,?,?)').run(id,type,scope,target,agent,Date.now());
      return this.registry.get(id);
    });
  }
}
