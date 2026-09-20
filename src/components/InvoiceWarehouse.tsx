import { useEffect, useMemo, useState } from 'react';
import { Download, FileArchive, FileText, RefreshCw, Trash2 } from 'lucide-react';
import type { ServiceInvoice } from '../types/electron';

const currentMonth=()=>new Date().toISOString().slice(0,7);
const money=(value:number)=>new Intl.NumberFormat('pl-PL',{style:'currency',currency:'PLN'}).format(value);

export function InvoiceWarehouse(){
  const [month,setMonth]=useState(currentMonth);
  const [invoices,setInvoices]=useState<ServiceInvoice[]>([]);
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');

  const load=async()=>{
    if(busy)return;
    setBusy('load');setError('');
    try{
      const result=await window.lockOn.service.listInvoices(month);
      setInvoices(result.invoices);
    }catch(reason){setError(reason instanceof Error?reason.message:'Nie udało się pobrać magazynu faktur.');}
    finally{setBusy('');}
  };
  useEffect(()=>{void load();},[month]);

  const total=useMemo(()=>invoices.reduce((sum,item)=>sum+(item.grossAmount||0),0),[invoices]);

  const download=async(invoice:ServiceInvoice)=>{
    if(busy)return;
    setBusy(invoice.id);setError('');setNotice('');
    try{
      const result=await window.lockOn.service.downloadInvoice(invoice.id);
      if(!result.cancelled)setNotice('Faktura została pobrana.');
    }catch(reason){setError(reason instanceof Error?reason.message:'Nie udało się pobrać faktury.');}
    finally{setBusy('');}
  };

  const downloadAll=async()=>{
    if(busy||!invoices.length)return;
    setBusy('all');setError('');setNotice('');
    try{
      const result=await window.lockOn.service.downloadInvoiceBatch(month);
      if(result.cancelled)return;
      setNotice('Pobrano '+result.downloaded+' faktur'+(result.failed?'. Nie udało się pobrać: '+result.failed+'.':' do wybranego folderu.'));
    }catch(reason){setError(reason instanceof Error?reason.message:'Nie udało się pobrać paczki faktur.');}
    finally{setBusy('');}
  };

  const remove=async(invoice:ServiceInvoice)=>{
    if(busy)return;
    if(!window.confirm('Usunąć fakturę „'+invoice.fileName+'” z prywatnego magazynu?'))return;
    setBusy('delete:'+invoice.id);setError('');setNotice('');
    try{
      await window.lockOn.service.deleteInvoice(invoice.id);
      setInvoices((current)=>current.filter((item)=>item.id!==invoice.id));
      setNotice('Faktura została usunięta.');
    }catch(reason){setError(reason instanceof Error?reason.message:'Nie udało się usunąć faktury.');}
    finally{setBusy('');}
  };

  return <section className="panel-card invoice-warehouse">
    <div className="panel-heading">
      <div><span className="eyebrow"><FileArchive size={13}/> MAGAZYN FAKTUR</span><h2>Faktury zakupu części</h2><p>Wszystkie prywatne PDF-y z napraw w jednym miejscu. Serwisant widzi faktury swoich przypisanych zleceń.</p></div>
      <div className="invoice-warehouse-actions">
        <input type="month" value={month} onChange={(e)=>setMonth(e.target.value)} disabled={Boolean(busy)}/>
        <button className="button small secondary" disabled={Boolean(busy)} onClick={()=>void load()}><RefreshCw className={busy==='load'?'spin':''} size={14}/> Odśwież</button>
        <button className="button small primary" disabled={Boolean(busy)||!invoices.length} onClick={()=>void downloadAll()}><Download size={14}/>{busy==='all'?'Pobieranie…':'Pobierz wszystkie PDF'}</button>
      </div>
    </div>
    {error&&<div className="service-inline-error">{error}</div>}
    {notice&&<div className="service-inline-success">{notice}</div>}
    <div className="invoice-warehouse-summary">
      <article><span>Dokumenty</span><strong>{invoices.length}</strong></article>
      <article><span>Suma kwot z opisanych FV</span><strong>{money(total)}</strong></article>
      <article><span>Miesiąc</span><strong>{month}</strong></article>
    </div>
    <div className="invoice-warehouse-list">
      {invoices.map((invoice)=><article key={invoice.id}>
        <div className="invoice-file-icon"><FileText size={18}/></div>
        <div className="invoice-file-main">
          <strong>{invoice.invoiceNumber||invoice.fileName}</strong>
          <span>{invoice.orderNumber!=null?'Zlecenie #'+invoice.orderNumber+' · ':''}{invoice.device||'Urządzenie'}{invoice.customerName?' · '+invoice.customerName:''}</span>
          <small>{invoice.supplier||'Brak dostawcy'}{invoice.invoiceDate?' · '+invoice.invoiceDate:''}{invoice.grossAmount!=null?' · '+money(invoice.grossAmount):''} · {(invoice.sizeBytes/1024/1024).toFixed(2)} MB</small>
        </div>
        <div className="invoice-file-actions">
          <button disabled={Boolean(busy)} title="Pobierz" onClick={()=>void download(invoice)}><Download size={15}/></button>
          <button disabled={Boolean(busy)} title="Usuń" onClick={()=>void remove(invoice)}><Trash2 size={15}/></button>
        </div>
      </article>)}
      {!invoices.length&&<div className="service-history-empty">W tym miesiącu nie ma zapisanych faktur PDF.</div>}
    </div>
  </section>;
}
