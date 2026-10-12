import {it,expect,afterEach} from 'vitest';
import {resolve} from 'node:path';
import {AcpClient} from '../../src/acp/client.js';
import {normalizeEvent} from '../../src/acp/event-normalizer.js';
const clients:AcpClient[]=[];
function client(mode='workspace-write'){
  const c=new AcpClient({command:process.execPath,args:[resolve('tests/fixtures/fake-agent.mjs')],cwd:process.cwd(),env:{...process.env,INITIAL_AGENT_MODE:mode}});clients.push(c);return c;
}
afterEach(async()=>{await Promise.all(clients.splice(0).map(c=>c.close()))});
it('stable ACP initialize/new/prompt/stream/load',async()=>{
  const c=client();expect((await c.initialize()).protocolVersion).toBe(1);const id=await c.open(process.cwd(),'owner-write');
  const events:unknown[]=[];c.onEvent=e=>events.push(...normalizeEvent(e));await c.prompt('hello');
  expect(JSON.stringify(events)).toContain('answer:hello');expect(JSON.stringify(events)).not.toContain('HIDDEN_THOUGHT');
  expect(await c.open(process.cwd(),'owner-write',id)).toBe(id);
});
it('permission request preserves allow-once and supports auto-deny',async()=>{
  const c=client();await c.open(process.cwd(),'owner-write');let permission=false;
  c.onPermission=async req=>{permission=true;return {outcome:{outcome:'selected',optionId:req.options.find(x=>x.kind==='allow_once')!.optionId}}};
  await c.prompt('permission');expect(permission).toBe(true);
  const r=client('read-only');await r.open(process.cwd(),'group-read');expect((await r.prompt('permission')).stopReason).toBe('end_turn');
});
it('cancel completes a long prompt',async()=>{
  const c=client();await c.open(process.cwd(),'owner-write');const turn=c.prompt('wait');await new Promise(r=>setTimeout(r,80));await c.cancel();expect((await turn).stopReason).toBe('cancelled');
});
it('errors and process crashes reject without crashing client',async()=>{
  const c=client();await c.open(process.cwd(),'owner-write');await expect(c.prompt('error')).rejects.toThrow();await expect(c.prompt('crash')).rejects.toThrow();
});
