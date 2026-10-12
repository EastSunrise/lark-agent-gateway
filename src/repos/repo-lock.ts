export class KeyedLock{
  private tails=new Map<string,Promise<void>>();
  async run<T>(key:string,fn:()=>Promise<T>):Promise<T>{
    const prev=this.tails.get(key)??Promise.resolve();let release!:()=>void;
    const next=new Promise<void>(r=>release=r);const tail=prev.then(()=>next);this.tails.set(key,tail);
    await prev;try{return await fn()}finally{release();if(this.tails.get(key)===tail)this.tails.delete(key)}
  }
}
export class Semaphore{
  private active=0;private waiting:(()=>void)[]=[];
  constructor(private limit:number){}
  async run<T>(fn:()=>Promise<T>){if(this.active>=this.limit)await new Promise<void>(r=>this.waiting.push(r));else this.active++;
    try{return await fn()}finally{const next=this.waiting.shift();if(next)next();else this.active--}
  }
}
