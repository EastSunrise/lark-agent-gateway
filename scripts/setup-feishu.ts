import { registerApp } from '@larksuite/channel';
import { existsSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {protectPath} from '../src/security/private-path.js';
const destination=resolve('.env.local');
if(existsSync(destination))throw new Error('.env.local already exists; keep existing credentials or explicitly move it before registration.');
const result=await registerApp({
  onQRCodeReady:({url,expireIn})=>console.log('扫描/打开授权链接（'+expireIn+'s 有效）：\n'+url),
  onStatusChange:s=>console.log('Registration: '+s.status),
});
writeFileSync(destination,'LARK_APP_ID='+result.client_id+'\nLARK_APP_SECRET='+result.client_secret+'\n',{mode:0o600,flag:'wx'});
protectPath(destination,false);
console.log('Credentials saved to .env.local. Configure Repo, then npm run doctor.');
