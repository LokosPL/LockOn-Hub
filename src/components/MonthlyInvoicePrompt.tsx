import { useEffect, useState } from 'react';
import { Download, FileArchive, X } from 'lucide-react';
import type { InvoiceMonthlyPrompt } from '../types/electron';

interface Props { onOpenWarehouse:()=>void; }

export function MonthlyInvoicePrompt({onOpenWarehouse}:Props){
  const [prompt,setPrompt]=useState<InvoiceMonthlyPrompt|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');

  useEffect(()=>{void window.lockOn.service.getInvoiceMonthlyPrompt().then(setPrompt).catch(()=>undefined);},[]);
  if(!prompt?.show||!prompt.period)return null;

  const dismiss=async()=>{
    if(busy)return;
    setBusy(true);
    try{
      await window.lockOn.service.dismissInvoiceMonthlyPrompt(prompt.period!);
      setPrompt({...prompt,show:false,dismissed:true});
    }finally{setBusy(false);}
  };

  const download=async()=>{
    if(busy)return;
    setBusy(true);setMessage('');
    try{
      const result=await window.lockOn.service.downloadInvoiceBatch(prompt.period!);
      if(result.cancelled)return;
      setMessage('Pobrano '+result.downloaded+' PDF.');
      await window.lockOn.service.dismissInvoiceMonthlyPrompt(prompt.period!);
      setPrompt({...prompt,show:false,dismissed:true});
    }catch(reason){setMessage(reason instanceof Error?reason.message:'Nie udało się pobrać faktur.');}
    finally{setBusy(false);}
  };

  return <div className="monthly-invoice-prompt">
    <div className="monthly-invoice-icon"><FileArchive size={20}/></div>
    <div><strong>Zamknięcie miesiąca · {prompt.period}</strong><span>Masz {prompt.count} faktur PDF z napraw. Możesz pobrać je teraz do jednego folderu albo wrócić do magazynu faktur później.</span>{message&&<small>{message}</small>}</div>
    <div className="monthly-invoice-actions">
      <button className="button small primary" disabled={busy} onClick={()=>void download()}><Download size={13}/> Pobierz wszystkie</button>
      <button className="button small secondary" disabled={busy} onClick={onOpenWarehouse}>Magazyn faktur</button>
      <button className="monthly-dismiss" disabled={busy} onClick={()=>void dismiss()} title="Odrzuć przypomnienie na ten miesiąc"><X size={15}/></button>
    </div>
  </div>;
}
