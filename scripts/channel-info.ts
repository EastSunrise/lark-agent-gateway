import {loadEnv} from '../src/config/load.js';
import {connectChannel} from '../src/channel/lark-channel.js';
loadEnv();
const channel=connectChannel();
try{
  await channel.connect();
  console.log('Bot identity:',JSON.stringify({name:channel.botIdentity?.name,openId:channel.botIdentity?.openId}));
  try{const info=await channel.getAppInfo();console.log('App:',JSON.stringify({appName:info.appName}))}catch{console.log('App metadata scope unavailable; bot identity still resolved.')}
  console.log('Connection:',channel.getConnectionStatus()?.state);
}finally{await channel.disconnect()}
