import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

export type ServiceOSDialogKind = 'confirm' | 'destructive' | 'info' | 'input';
export type ServiceOSDialogOptions = {
  kind?: ServiceOSDialogKind;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  inputLabel?: string;
  inputValue?: string;
  inputPlaceholder?: string;
};

type DialogResult = boolean | string | null;
type PendingDialog = ServiceOSDialogOptions & { resolve:(value:DialogResult)=>void };

const DialogContext = createContext<((options:ServiceOSDialogOptions)=>Promise<DialogResult>) | null>(null);

export function ServiceOSDialogProvider({children}:{children:ReactNode}) {
  const [pending,setPending]=useState<PendingDialog|null>(null);
  const [input,setInput]=useState('');
  const activeRef=useRef<PendingDialog|null>(null);

  const ask=useCallback((options:ServiceOSDialogOptions)=>new Promise<DialogResult>((resolve)=>{
    const request={...options,kind:options.kind??'confirm',resolve};
    activeRef.current=request;
    setInput(options.inputValue??'');
    setPending(request);
  }),[]);

  const finish=(value:DialogResult)=>{
    const request=activeRef.current;
    activeRef.current=null;
    setPending(null);
    request?.resolve(value);
  };

  const value=useMemo(()=>ask,[ask]);
  const destructive=pending?.kind==='destructive';
  const info=pending?.kind==='info';
  const inputMode=pending?.kind==='input';

  return <DialogContext.Provider value={value}>
    {children}
    {pending && <div className="serviceos-dialog-backdrop" role="presentation" onMouseDown={()=>finish(info?true:false)}>
      <section className={"serviceos-dialog "+(destructive?'destructive':'')} role="dialog" aria-modal="true" aria-labelledby="serviceos-dialog-title" onMouseDown={(event)=>event.stopPropagation()}>
        <header>
          <span>{destructive?'OPERACJA WYMAGA POTWIERDZENIA':info?'INFORMACJA':'SERVICEOS'}</span>
          <h2 id="serviceos-dialog-title">{pending.title}</h2>
        </header>
        {pending.message && <p>{pending.message}</p>}
        {inputMode && <label className="serviceos-dialog-input">
          <span>{pending.inputLabel??'Wartość'}</span>
          <input autoFocus value={input} placeholder={pending.inputPlaceholder??''} onChange={(event)=>setInput(event.target.value)} onKeyDown={(event)=>{if(event.key==='Enter')finish(input.trim());}}/>
        </label>}
        <footer>
          {!info && <button className="button secondary" onClick={()=>finish(inputMode?null:false)}>{pending.cancelLabel??'Anuluj'}</button>}
          <button className={"button "+(destructive?'danger':'primary')} onClick={()=>finish(inputMode?input.trim():true)}>
            {pending.confirmLabel??(info?'OK':destructive?'Usuń':'Potwierdź')}
          </button>
        </footer>
      </section>
    </div>}
  </DialogContext.Provider>;
}

export function useServiceOSDialog(){
  const ask=useContext(DialogContext);
  if(!ask)throw new Error('useServiceOSDialog musi działać wewnątrz ServiceOSDialogProvider.');
  return ask;
}
