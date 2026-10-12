import type { InitializeResponse } from '@agentclientprotocol/sdk';
export function validateCapabilities(info:InitializeResponse){
  if(info.protocolVersion!==1)throw new Error('ACP stable v1 required');
  return {loadSession:info.agentCapabilities?.loadSession===true};
}
