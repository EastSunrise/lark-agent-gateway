import type { NormalizedMessage,CardActionEvent } from '@larksuite/channel';
import type { Config } from './config/schema.js';
import type { Store } from './storage/repositories.js';
import type { OwnerService } from './identity/owner-service.js';
import type { RepoRegistry } from './repos/registry.js';
import { ConversationManager } from './conversations/conversation-manager.js';
import type { TaskManager } from './tasks/task-manager.js';
import type { ChannelPort } from './presenter/reply.js';
import { replyOptions } from './presenter/reply.js';
import { parseCommand,help } from './commands/command-router.js';
import { policy } from './policy/policy-engine.js';
import {redact} from './security/redactor.js';
import type {DefaultRepoService} from './repos/default-repo-service.js';
export class Gateway{
  private conversations:ConversationManager;
  constructor(private config:Config,private store:Store,private owner:OwnerService,private repos:RepoRegistry,private tasks:TaskManager,private channel:ChannelPort,private groupSafe:boolean,private defaultRepos?:DefaultRepoService){this.conversations=new ConversationManager(store)}
  async message(msg:NormalizedMessage){
    if(msg.senderIsBot||msg.senderType==='bot')return;
    if(msg.chatType==='group'&&(!msg.mentionedBot||msg.mentionAll))return;
    if(!this.store.dedup(msg.messageId))return;
    const reply=(text:string)=>this.channel.send(msg.chatId,{markdown:msg.chatType==='group'?redact(text):text},replyOptions(msg,this.config.feishu.groupReplyMode));
    const dm=msg.chatType==='p2p';const owner=this.owner.isOwner(msg.senderId);const cmd=parseCommand(msg.content);
    if(cmd?.name==='/claim'){
      await reply(this.owner.claim(msg.senderId,cmd.args[0]??'',dm)?'Owner 认领成功。发送 /help 查看命令。':'认领失败、已过期或 Owner 已设置。');return;
    }
    if(dm&&!owner){await reply('仅 Owner 可以私聊使用。');return}
    let binding=this.store.binding(msg.chatId);
    if(cmd?.name==='/help'){await reply(help);return}
    if(cmd?.name==='/repo'&&cmd.args[0]==='list'){
      if(!owner&&!binding){await reply('该群尚未绑定项目。请 Owner 使用 /repo bind <repo>');return}
      await reply((owner?this.repos.list().map(r=>r.id):[binding!.repo_id]).join('\n'));return;
    }
    if(cmd?.name==='/repo'&&['bind','use'].includes(cmd.args[0])){
      if(!owner){await reply('仅 Owner 可以选择或绑定项目。');return}
      if((cmd.args[0]==='bind')===dm){await reply('私聊使用 /repo use，群聊使用 /repo bind。');return}
      const repo=this.repos.get(cmd.args[1]??'');
      if(dm)this.store.prefer(msg.chatId,repo.id,null);else this.store.bind(msg.chatId,repo.id,repo.defaultAgent,msg.senderId);
      await reply('项目已选择：'+repo.id);return;
    }
    const pref=dm?this.store.preference(msg.chatId):undefined;
    let repoId=dm?(pref?.repo_id??Object.keys(this.config.repos)[0]):binding?.repo_id;
    if(!repoId&&owner&&!cmd&&this.defaultRepos&&this.config.repoDefaults.enabled){
      const created=await this.defaultRepos.ensure(msg.chatId,dm);repoId=created.id;
      if(dm)this.store.prefer(msg.chatId,created.id,null);
      else{this.store.bind(msg.chatId,created.id,created.defaultAgent,msg.senderId);binding=this.store.binding(msg.chatId)}
      await reply('已创建并选择默认项目：'+created.id);
    }
    if(!repoId){await reply(dm?'尚未选择项目。直接发送任务可自动创建默认 Repo。':'该群尚未绑定项目。Owner 直接 @机器人发送任务可自动创建默认 Repo，也可 /repo bind <repo>。');return}
    const repo=this.repos.get(repoId);
    const agent=(dm?pref?.agent_name:binding?.default_agent)??repo.defaultAgent;
    if(cmd?.name==='/agent'&&cmd.args[0]==='list'){await reply(Object.entries(this.config.agents).filter(([,v])=>v.enabled).map(([k])=>k).join('\n'));return}
    if(cmd?.name==='/agent'&&cmd.args[0]==='use'){
      if(!owner){await reply('仅 Owner 可以切换 Agent。');return}
      const selected=cmd.args[1];if(!this.config.agents[selected]?.enabled)throw new Error('Unknown/disabled Agent');
      if(dm)this.store.prefer(msg.chatId,null,selected);else this.store.bind(msg.chatId,repoId,selected,msg.senderId);
      await reply('Agent 已选择：'+selected);return;
    }
    const thread=this.config.feishu.groupReplyMode==='thread'
      ?msg.rootId??msg.threadId??msg.messageId
      :JSON.stringify(this.config.feishu.groupConversationScope==='sender'?['sender',msg.senderId]:['chat']);
    const conv=this.conversations.findOrCreate(msg.chatId,dm,thread,repoId,agent);
    if(cmd?.name==='/new'){
      if(!owner&&(this.config.feishu.groupReplyMode==='thread'||this.config.feishu.groupConversationScope==='chat')){await reply('仅 Owner 可以重置共享会话。');return}
      this.conversations.reset(conv.id);await reply('新会话已准备；下一条消息将获取最新 HEAD。');return;
    }
    if(cmd?.name==='/status'){await reply(this.tasks.status(conv.id).map(x=>x.id+' '+x.status).join('\n')||'当前无任务');return}
    if(cmd?.name==='/stop'){
      const ids=this.tasks.status(conv.id);let stopped=0;for(const task of ids)if(await this.tasks.cancel(task.id,msg.senderId))stopped++;
      await reply(stopped?'已取消 '+stopped+' 个任务。':'没有可取消的任务。');return;
    }
    if(cmd){await reply('未知命令。\n'+help);return}
    const mode=policy({owner,dm,mentioned:msg.mentionedBot,mentionAll:msg.mentionAll,bound:!!binding,groupSafe:this.groupSafe&&agent==='codex'&&this.config.agents[agent].groupRead});
    if(mode==='UNSAFE'){await reply('Group Read 安全验证未通过，群成员任务已禁用。Owner 仍可使用。');return}
    if(mode==='group-read'||mode==='owner-write')this.tasks.submit(msg,conv,mode);
  }
  async cardAction(event:CardActionEvent){
    const v=event.action.value as Record<string,unknown>|null;
    if(!v||typeof v!=='object')return {toast:{type:'error',content:'无效操作'}};
    let success=false;
    if(v.kind==='approval'&&typeof v.approvalId==='string'&&(v.decision==='allow'||v.decision==='reject'))success=this.tasks.approvals.decide(v.approvalId,event.operator.openId,v.decision);
    if(v.kind==='cancel'&&typeof v.taskId==='string')success=await this.tasks.cancel(v.taskId,event.operator.openId);
    return {toast:{type:success?'success':'error',content:success?'已处理':'没有权限、已处理或已过期'}};
  }
}
