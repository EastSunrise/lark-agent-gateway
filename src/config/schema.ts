import { z } from 'zod';
export const defaultDeny = ['**/.env','**/.env.*','**/*.pem','**/*.key','**/*.p12','**/*.pfx','**/.npmrc','**/.pypirc','**/credentials*','**/secrets*'];
export const configSchema = z.object({
  runtime: z.object({ maxConcurrentTasks: z.number().int().min(1).max(32).default(3), stateDir: z.string().optional(), idleSessionMinutes: z.number().positive().default(30) }).default({maxConcurrentTasks:3,idleSessionMinutes:30}),
  owner: z.object({ openId: z.string().regex(/^ou_/).optional() }).default({}),
  feishu: z.object({
    requireMentionInGroup: z.literal(true).default(true),
    groupReplyMode: z.enum(['chat','thread']).default('chat'),
    groupConversationScope: z.enum(['sender','chat']).default('chat'),
  }).default({requireMentionInGroup:true,groupReplyMode:'chat',groupConversationScope:'chat'}),
  repoDefaults: z.object({
    enabled:z.boolean().default(true),
    root:z.string().optional(),
    defaultAgent:z.string().default('codex'),
    groupScope:z.enum(['group','shared']).default('group'),
  }).default({enabled:true,defaultAgent:'codex',groupScope:'group'}),
  agents: z.record(z.string().regex(/^[a-zA-Z0-9_-]+$/), z.object({ enabled: z.boolean().default(true), command: z.string().default('codex-acp'), args: z.array(z.string()).default([]), groupRead: z.boolean().default(false) })).default({codex:{enabled:true,command:'codex-acp',args:[],groupRead:true}}),
  repos: z.record(z.string().regex(/^[a-zA-Z0-9_-]+$/), z.object({path:z.string().min(1),defaultAgent:z.string().default('codex')})).default({}),
  security: z.object({groupRead:z.object({network:z.literal(false).default(false),deny:z.array(z.string()).default(defaultDeny)}).default({network:false,deny:defaultDeny})}).default({groupRead:{network:false,deny:defaultDeny}}),
  worktrees:z.object({retentionDays:z.number().positive().default(7)}).default({retentionDays:7}),
});
export type Config = z.infer<typeof configSchema>;
