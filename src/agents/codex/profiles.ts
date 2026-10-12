import type { Profile } from '../../policy/policy-engine.js';
import type { RepoView } from '../../repos/repo-view-manager.js';
import { join } from 'node:path';
export function codexConfig(profile:Profile,view:RepoView,deny:string[]){
  if(profile==='owner-write')return {sandbox_mode:'workspace-write',approval_policy:'on-request',web_search:'disabled'};
  const filesystem:Record<string,unknown>={':root':'deny',':minimal':'read',glob_scan_max_depth:64};
  for(const root of view.readRoots)filesystem[root]={'.':'read',...Object.fromEntries(deny.map(p=>[p,'deny']))};
  // Git metadata includes credentials/hooks/config. Deny those even if tracked.
  for(const root of view.readRoots.slice(1))for(const item of ['config','hooks','logs','worktrees'])filesystem[join(root,item)]='deny';
  return {
    default_permissions:'gateway-group-read',
    permissions:{'gateway-group-read':{filesystem,network:{enabled:false}}},
    approval_policy:'never',web_search:'disabled',mcp_servers:{},
    features:{shell_tool:true,multi_agent:false},
  };
}
