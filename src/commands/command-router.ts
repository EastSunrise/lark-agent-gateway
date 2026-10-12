export function parseCommand(text:string){const trimmed=text.trim();if(!trimmed.startsWith('/'))return null;const [name,...args]=trimmed.split(/\s+/);return {name,args}}
export const help='/help\n/repo list\n/repo use <repo> (Owner 私聊)\n/repo bind <repo> (Owner 群聊)\n/agent list\n/agent use <agent> (Owner)\n/new\n/status\n/stop\n\n直接发送自然语言任务；群聊需要 @机器人。';
