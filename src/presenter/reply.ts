import type { NormalizedMessage,SendInput,SendOptions,SendResult,StreamInput } from '@larksuite/channel';
export interface ChannelPort {send(to:string,input:SendInput,opts?:SendOptions):Promise<SendResult>;updateCard(messageId:string,card:object):Promise<void>;stream?(to:string,input:StreamInput,opts?:SendOptions):Promise<SendResult>}
export const replyOptions=(msg:Pick<NormalizedMessage,'messageId'|'chatType'>,groupReplyMode:'chat'|'thread'='chat'):SendOptions=>({replyTo:msg.messageId,replyInThread:msg.chatType==='group'&&groupReplyMode==='thread'});
