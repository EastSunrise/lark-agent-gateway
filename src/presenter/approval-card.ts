export function approvalCard(id:string,repo:string,subject:string,reason:string,status='PENDING'){
  return {config:{wide_screen_mode:true},header:{template:'orange',title:{tag:'plain_text',content:'⚠️ Agent 请求权限 · '+status}},
    elements:[{tag:'markdown',content:'**Repo** '+repo+'\n**Action** '+subject.slice(0,3000)+'\n**Reason** '+reason.slice(0,3000)},
    ...(status==='PENDING'?[{tag:'action',actions:['allow','reject'].map(action=>({tag:'button',type:action==='allow'?'primary':'default',text:{tag:'plain_text',content:action==='allow'?'批准一次':'拒绝'},value:{kind:'approval',approvalId:id,decision:action}}))}]:[])]};
}
