import type { NormalizedMessage,SendInput,SendOptions,SendResult } from '@larksuite/channel';
export interface ChannelPort {send(to:string,input:SendInput,opts?:SendOptions):Promise<SendResult>;updateCard(messageId:string,card:object):Promise<void>}
export const replyOptions=(msg:Pick<NormalizedMessage,'messageId'|'chatType'>):SendOptions=>({replyTo:msg.messageId,replyInThread:msg.chatType==='group'});
