export type AppDialogTone = 'default' | 'danger';
export interface AppDialogRequest {
  title:string;
  message:string;
  confirmLabel?:string;
  cancelLabel?:string;
  tone?:AppDialogTone;
  input?:{label?:string;placeholder?:string;initialValue?:string;requiredText?:string};
}
export interface AppDialogResult { confirmed:boolean; value?:string; }

type Listener=(request:(AppDialogRequest & {id:number})|null)=>void;
let listener:Listener|null=null;
let pending:{id:number;resolve:(result:AppDialogResult)=>void}|null=null;
let sequence=0;

export const subscribeAppDialog=(next:Listener)=>{
  listener=next;
  return()=>{if(listener===next)listener=null;};
};

export const resolveAppDialog=(id:number,result:AppDialogResult)=>{
  if(!pending||pending.id!==id)return;
  const current=pending;pending=null;listener?.(null);current.resolve(result);
};

const open=(request:AppDialogRequest)=>new Promise<AppDialogResult>((resolve)=>{
  if(pending){pending.resolve({confirmed:false});pending=null;}
  const id=++sequence;pending={id,resolve};listener?.({...request,id});
});

export const appConfirm=async(request:AppDialogRequest|string)=>{
  const normalized=typeof request==='string'?{title:'Potwierdź operację',message:request}:request;
  return (await open(normalized)).confirmed;
};

export const appPrompt=async(request:AppDialogRequest)=>{
  const result=await open(request);
  return result.confirmed?(result.value??''):null;
};
