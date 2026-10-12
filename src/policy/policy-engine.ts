export type Profile='group-read'|'owner-write';
export function policy(input:{owner:boolean;dm:boolean;mentioned:boolean;mentionAll:boolean;bound:boolean;groupSafe:boolean}):Profile|'DENY'|'IGNORE'|'UNBOUND'|'UNSAFE'{
  if(input.dm)return input.owner?'owner-write':'DENY';
  if(!input.mentioned||input.mentionAll)return 'IGNORE';
  if(!input.bound)return 'UNBOUND';
  if(input.owner)return 'owner-write';
  return input.groupSafe?'group-read':'UNSAFE';
}
