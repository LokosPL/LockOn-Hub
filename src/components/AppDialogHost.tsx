import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { resolveAppDialog, subscribeAppDialog, type AppDialogRequest } from '../appDialog';

type Active=AppDialogRequest & {id:number};

export function AppDialogHost(){
  const [active,setActive]=useState<Active|null>(null);
  const [value,setValue]=useState('');
  useEffect(()=>subscribeAppDialog((request)=>{setActive(request);setValue(request?.input?.initialValue??'');}),[]);
  if(!active)return null;
  const required=active.input?.requiredText;
  const canConfirm=!required||value===required;
  const close=(confirmed:boolean)=>resolveAppDialog(active.id,{confirmed,value});
  return <div className="app-dialog-backdrop" role="presentation" onMouseDown={()=>close(false)}>
    <section className={"app-dialog "+(active.tone==='danger'?'danger':'')} role="dialog" aria-modal="true" aria-label={active.title} onMouseDown={(e)=>e.stopPropagation()}>
      <header><span className="app-dialog-icon">{active.tone==='danger'?<AlertTriangle size={19}/>:<CheckCircle2 size={19}/>}</span><div><strong>{active.title}</strong><small>LockOn ServiceOS</small></div><button onClick={()=>close(false)} aria-label="Zamknij"><X size={18}/></button></header>
      <div className="app-dialog-body"><p>{active.message}</p>
        {active.input&&<label><span>{active.input.label||'Wpisz wartość'}</span><input autoFocus value={value} onChange={(e)=>setValue(e.target.value)} placeholder={active.input.placeholder||''} onKeyDown={(e)=>{if(e.key==='Enter'&&canConfirm)close(true);}}/>{required&&<small>Wpisz dokładnie: <b>{required}</b></small>}</label>}
      </div>
      <footer><button className="button secondary" onClick={()=>close(false)}>{active.cancelLabel||'Anuluj'}</button><button className={"button "+(active.tone==='danger'?'danger':'primary')} disabled={!canConfirm} onClick={()=>close(true)}>{active.confirmLabel||'Potwierdź'}</button></footer>
    </section>
  </div>;
}
