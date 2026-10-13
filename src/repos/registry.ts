import { realpath } from 'node:fs/promises';
import { isAbsolute, normalize } from 'node:path';
import { execa } from 'execa';
import type { Config } from '../config/schema.js';
export interface Repo {id:string;path:string;defaultAgent:string}
export class RepoRegistry{
  private repos=new Map<string,Repo>();
  async initialize(config:Config){
    for(const [id,item] of Object.entries(config.repos)){
      await this.register(id,item,config);
    }
  }
  async register(id:string,item:{path:string;defaultAgent:string},config:Config){
      if(!/^[a-zA-Z0-9_-]+$/.test(id))throw new Error('Invalid Repo id');
      if(!isAbsolute(item.path)||item.path.split(/[\\/]/).includes('..'))throw new Error('Repo must be an absolute path without ..: '+id);
      const path=await realpath(item.path);
      const {stdout}=await execa('git',['-C',path,'rev-parse','--show-toplevel']);
      if(normalize(await realpath(stdout.trim()))!==normalize(path))throw new Error('Repo path must be Git root: '+id);
      if(!config.agents[item.defaultAgent]?.enabled)throw new Error('Unknown/disabled default agent: '+id);
      const prior=this.repos.get(id);if(prior&&prior.path!==path)throw new Error('Repo id conflicts with existing registration: '+id);
      this.repos.set(id,{id,path,defaultAgent:item.defaultAgent});
  }
  get(id:string){const repo=this.repos.get(id);if(!repo)throw new Error('Unknown registered Repo: '+id);return repo}
  list(){return [...this.repos.values()]}
}
