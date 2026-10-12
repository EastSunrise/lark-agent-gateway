import { join, resolve, relative } from 'node:path';
import { realpath, readdir, stat } from 'node:fs/promises';
import { execa } from 'execa';
import { nanoid } from 'nanoid';
import { privateDirectory } from '../config/load.js';
import type { RepoRegistry } from './registry.js';
export interface RepoView {repoId:string;revision:string;cwd:string;readRoots:string[]}
export class RepoViewManager {
  constructor(private registry:RepoRegistry,private stateDir:string){}
  async createGroupView(repoId:string):Promise<RepoView>{
    const repo=this.registry.get(repoId);const {stdout}=await execa('git',['-C',repo.path,'rev-parse','HEAD']);const revision=stdout.trim();
    const parent=join(this.stateDir,'worktrees',repoId,revision);privateDirectory(parent);const cwd=join(parent,nanoid());
    await execa('git',['-C',repo.path,'worktree','add','--detach',cwd,revision]);
    const admin=(await execa('git',['-C',cwd,'rev-parse','--absolute-git-dir'])).stdout.trim();
    const common=(await execa('git',['-C',cwd,'rev-parse','--path-format=absolute','--git-common-dir'])).stdout.trim();
    // Never grant the real working tree. Common metadata can contain secrets;
    // its config/hooks are explicitly denied by the group profile.
    return {repoId,revision,cwd:await realpath(cwd),readRoots:[await realpath(cwd),await realpath(admin),await realpath(common)]};
  }
  async getOwnerView(repoId:string):Promise<RepoView>{
    const repo=this.registry.get(repoId);const revision=(await execa('git',['-C',repo.path,'rev-parse','HEAD'])).stdout.trim();
    return {repoId,revision,cwd:repo.path,readRoots:[repo.path]};
  }
  async release(view:RepoView){
    const root=resolve(this.stateDir,'worktrees');const rel=relative(root,resolve(view.cwd));
    if(!rel||rel.startsWith('..')||resolve(view.cwd)===this.registry.get(view.repoId).path)throw new Error('Refusing unsafe worktree removal');
    await execa('git',['-C',this.registry.get(view.repoId).path,'worktree','remove',view.cwd]);
  }
  async cleanup(references:Set<string>,days:number){
    for(const repo of this.registry.list()){
      const dir=join(this.stateDir,'worktrees',repo.id);
      for(const sha of await readdir(dir).catch(()=>[])){
        for(const id of await readdir(join(dir,sha)).catch(()=>[])){
          const cwd=join(dir,sha,id);if(references.has(cwd))continue;
          if(Date.now()-(await stat(cwd)).mtimeMs<days*86400000)continue;
          await this.release({repoId:repo.id,revision:sha,cwd,readRoots:[]}).catch(()=>{});
        }
      }
    }
  }
}
