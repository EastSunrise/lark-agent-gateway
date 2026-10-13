import {it,expect} from 'vitest';
import {TaskPresenter,taskCard} from '../../src/presenter/task-card.js';
import type {StreamInput} from '@larksuite/channel';
it('official streaming lifecycle starts once, accumulates/redacts chunks, and closes',async()=>{
  const updates:unknown[]=[];let started=0;
  const port={send:async()=>({messageId:'unused'}),updateCard:async()=>{},
    stream:async(_to:string,input:StreamInput)=>{
      started++;if(!('card' in input))throw new Error('Expected card stream');
      updates.push(input.card.initial);await input.card.producer({messageId:'stream',current:input.card.initial,update:async value=>{updates.push(value)}});return {messageId:'stream'};
    }};
  const p=new TaskPresenter(port,'group',{}, {taskId:'t',repo:'r',agent:'a',mode:'READ',status:'RUNNING',current:'read',text:'',files:new Set()},true);
  await p.start();p.event({type:'assistant_delta',text:'Bearer '});p.event({type:'assistant_delta',text:'secret123'});
  await p.finish('COMPLETED');expect(started).toBe(1);expect(JSON.stringify(updates)).not.toContain('secret123');expect(JSON.stringify(updates)).toContain('REDACTED');
});
it('redacts a private key longer than the display window before truncation, including streamed incomplete keys',()=>{
  const base={taskId:'t',repo:'r',agent:'a',mode:'WRITE',status:'RUNNING',current:'read',text:'',files:new Set<string>()};
  const header='-----BEGIN PRIVATE KEY-----\n';const key='SENSITIVE_KEY_BYTES'.repeat(1500);
  for(const text of [header+key,header+key+'\n-----END PRIVATE KEY-----']){
    const card=JSON.stringify(taskCard({...base,text},true));
    expect(card).not.toContain('SENSITIVE_KEY_BYTES');expect(card).toContain('[REDACTED]');
  }
});
