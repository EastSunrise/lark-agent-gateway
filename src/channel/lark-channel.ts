import { createLarkChannel } from '@larksuite/channel';
export function connectChannel(){
  const appId=process.env.LARK_APP_ID,appSecret=process.env.LARK_APP_SECRET;
  if(!appId||!appSecret)throw new Error('Missing LARK_APP_ID/LARK_APP_SECRET in .env.local');
  return createLarkChannel({appId,appSecret,transport:'websocket',respectProxyEnv:true,
    policy:{requireMention:true,dmMode:'open',respondToMentionAll:false},
    safety:{chatQueue:{enabled:true,mergeWhileBusy:false,cardActions:'separate'}},
    loggerLevel:1,source:'lark-agent-gateway'});
}
