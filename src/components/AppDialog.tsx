import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode
} from 'react';
import { AlertTriangle, CheckCircle2, Info, ShieldAlert, X } from 'lucide-react';

type DialogTone = 'default' | 'warning' | 'danger';

export interface AppConfirmOptions {
  title: string;
  message: string;
  detail?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: DialogTone;
}

export interface AppPromptOptions extends AppConfirmOptions {
  inputLabel?: string;
  placeholder?: string;
  initialValue?: string;
  requiredText?: string;
  multiline?: boolean;
}

type DialogRequest =
  | { kind:'confirm'; options:AppConfirmOptions; resolve:(value:boolean)=>void }
  | { kind:'prompt'; options:AppPromptOptions; resolve:(value:string|null)=>void };

interface AppDialogApi {
  confirm: (options:AppConfirmOptions) => Promise<boolean>;
  prompt: (options:AppPromptOptions) => Promise<string|null>;
}

const AppDialogContext=createContext<AppDialogApi|null>(null);

export function AppDialogProvider({children}:{children:ReactNode}) {
  const [request,setRequest]=useState<DialogRequest|null>(null);
  const [input,setInput]=useState('');
  const inputRef=useRef<HTMLInputElement|HTMLTextAreaElement|null>(null);

  const finish=useCallback((value:boolean|string|null)=>{
    setRequest((current)=>{
      if(!current)return null;
      if(current.kind==='confirm')current.resolve(Boolean(value));
      else current.resolve(typeof value==='string'?value:null);
      return null;
    });
  },[]);

  const confirm=useCallback((options:AppConfirmOptions)=>new Promise<boolean>((resolve)=>{
    setInput('');
    setRequest({kind:'confirm',options,resolve});
  }),[]);

  const prompt=useCallback((options:AppPromptOptions)=>new Promise<string|null>((resolve)=>{
    setInput(options.initialValue??'');
    setRequest({kind:'prompt',options,resolve});
  }),[]);

  useEffect(()=>{
    if(!request)return;
    const onKey=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){
        event.preventDefault();
        finish(request.kind==='confirm'?false:null);
      }
    };
    window.addEventListener('keydown',onKey);
    const timer=window.setTimeout(()=>inputRef.current?.focus(),40);
    return()=>{window.clearTimeout(timer);window.removeEventListener('keydown',onKey);};
  },[request,finish]);

  const api=useMemo(()=>({confirm,prompt}),[confirm,prompt]);
  const options=request?.options;
  const tone=options?.tone??'default';
  const Icon=tone==='danger'?ShieldAlert:tone==='warning'?AlertTriangle:options?.confirmLabel?.toLocaleLowerCase('pl-PL').includes('usuń')?ShieldAlert:Info;
  const exact=request?.kind==='prompt' ? request.options.requiredText : undefined;
  const canConfirm=request?.kind!=='prompt' || exact===undefined || input===exact;

  return <AppDialogContext.Provider value={api}>
    {children}
    {request&&options&&<div
      className="app-dialog-backdrop"
      role="presentation"
      onMouseDown={()=>finish(request.kind==='confirm'?false:null)}
    >
      <section
        className={`app-dialog-panel tone-${tone}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-dialog-title"
        onMouseDown={(event)=>event.stopPropagation()}
      >
        <button
          type="button"
          className="app-dialog-close"
          aria-label="Zamknij"
          onClick={()=>finish(request.kind==='confirm'?false:null)}
        ><X size={17}/></button>
        <div className="app-dialog-head">
          <div className="app-dialog-icon"><Icon size={22}/></div>
          <div>
            <span>SERVICEOS · POTWIERDZENIE</span>
            <h2 id="app-dialog-title">{options.title}</h2>
            <p>{options.message}</p>
          </div>
        </div>
        {options.detail&&<div className="app-dialog-detail">{options.detail}</div>}
        {request.kind==='prompt'&&<label className="app-dialog-field">
          <span>{request.options.inputLabel??'Wpisz wartość'}</span>
          {request.options.multiline
            ? <textarea
                ref={(node)=>{inputRef.current=node;}}
                rows={4}
                value={input}
                placeholder={request.options.placeholder}
                onChange={(event)=>setInput(event.target.value)}
              />
            : <input
                ref={(node)=>{inputRef.current=node;}}
                value={input}
                placeholder={request.options.placeholder}
                onChange={(event)=>setInput(event.target.value)}
                onKeyDown={(event)=>{
                  if(event.key==='Enter'&&canConfirm){
                    event.preventDefault();
                    finish(input);
                  }
                }}
              />}
          {exact!==undefined&&<small>Wpisz dokładnie: <strong>{exact}</strong></small>}
        </label>}
        <div className="app-dialog-actions">
          <button
            type="button"
            className="button secondary"
            onClick={()=>finish(request.kind==='confirm'?false:null)}
          >{options.cancelLabel??'Anuluj'}</button>
          <button
            type="button"
            className={`button ${tone==='danger'?'danger-soft':'primary'}`}
            disabled={!canConfirm}
            onClick={()=>finish(request.kind==='confirm'?true:input)}
          >
            {tone==='default'&&<CheckCircle2 size={15}/>}
            {options.confirmLabel??'Potwierdź'}
          </button>
        </div>
      </section>
    </div>}
  </AppDialogContext.Provider>;
}

export function useAppDialog(){
  const value=useContext(AppDialogContext);
  if(!value)throw new Error('useAppDialog musi być użyty wewnątrz AppDialogProvider.');
  return value;
}
