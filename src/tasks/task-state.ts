export type TaskState='RECEIVED'|'RUNNING'|'WAITING_APPROVAL'|'COMPLETED'|'FAILED'|'CANCELLED'|'INTERRUPTED';
const edges:Record<TaskState,TaskState[]>={RECEIVED:['RUNNING','CANCELLED','FAILED','INTERRUPTED'],RUNNING:['WAITING_APPROVAL','COMPLETED','FAILED','CANCELLED','INTERRUPTED'],WAITING_APPROVAL:['RUNNING','FAILED','CANCELLED','INTERRUPTED'],COMPLETED:[],FAILED:[],CANCELLED:[],INTERRUPTED:[]};
export function transition(from:TaskState,to:TaskState){if(!edges[from].includes(to))throw new Error('Invalid task transition '+from+' → '+to);return to}
export const terminalStates=new Set<string>(['COMPLETED','FAILED','CANCELLED','INTERRUPTED']);
