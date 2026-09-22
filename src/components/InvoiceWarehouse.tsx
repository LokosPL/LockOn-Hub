import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Download, FileArchive, FileText, RefreshCw, Search, Trash2 } from 'lucide-react';
import type { ServiceInvoice } from '../types/electron';

const monthKey=(date:Date)=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
const currentMonth=()=>monthKey(new Date());
const money=(value:number)=>new Intl.NumberFormat('pl-PL',{style:'currency',currency:'PLN'}).format(value);
const monthLabel=(value:string)=>{
  const [year,month]=value.split('-').map(Number);
  if(!year||!month)return value;
  return new Date(year,month-1,1).toLocaleDateString('pl-PL',{month:'long',year:'numeric'});
};
const shiftMonth=(value:string,delta:number)=>{
  const [year,month]=value.split('-').map(Number);
  const date=new Date(year||new Date().getFullYear(),(month||1)-1+delta,1);
  return monthKey(date);
};

export function InvoiceWarehouse(){
  const [month,setMonth]=useState(currentMonth);
  const [invoices,setInvoices]=useState<ServiceInvoice[]>([]);
  const [query,setQuery]=useState('');
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

  const filtered=useMemo(()=>{
    const term=query.trim().toLocaleLowerCase('pl-PL');
    const sorted=[...invoices].sort((a,b)=>String(b.invoiceDate||b.createdAt).localeCompare(String(a.invoiceDate||a.createdAt)));
    if(!term)return sorted;
    return sorted.filter((invoice)=>[
      invoice.invoiceNumber,invoice.fileName,invoice.supplier,invoice.customerName,invoice.device,
      invoice.orderNumber==null?'':String(invoice.orderNumber)
    ].some((value)=>String(value||'').toLocaleLowerCase('pl-PL').includes(term)));
  },[invoices,query]);

  const total=useMemo(()=>filtered.reduce((sum,item)=>sum+(item.grossAmount||0),0),[filtered]);
  const fullTotal=useMemo(()=>invoices.reduce((sum,item)=>sum+(item.grossAmount||0),0),[invoices]);
  const suppliers=useMemo(()=>new Set(invoices.map((item)=>item.supplier?.trim()).filter(Boolean)).size,[invoices]);

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

  return <section className="panel-card invoice-warehouse invoice-warehouse-v2">
    <div className="panel-heading invoice-warehouse-heading">
      <div>
        <span className="eyebrow"><FileArchive size={13}/> MAGAZYN FAKTUR</span>
        <h2>Faktury zakupu części</h2>
        <p>Szybkie wyszukiwanie po numerze faktury, dostawcy, kliencie, urządzeniu albo numerze zlecenia.</p>
      </div>
      <button className="button small secondary" disabled={Boolean(busy)} onClick={()=>void load()}><RefreshCw className={busy==='load'?'spin':''} size={14}/> Odśwież</button>
    </div>

    <div className="invoice-toolbar">
      <div className="invoice-month-nav">
        <button className="button small secondary" disabled={Boolean(busy)} onClick={()=>setMonth((value)=>shiftMonth(value,-1))} title="Poprzedni miesiąc"><ChevronLeft size={15}/></button>
        <label><CalendarDays size={14}/><input type="month" value={month} onChange={(e)=>setMonth(e.target.value)} disabled={Boolean(busy)}/></label>
        <button className="button small secondary" disabled={Boolean(busy)} onClick={()=>setMonth((value)=>shiftMonth(value,1))} title="Następny miesiąc"><ChevronRight size={15}/></button>
        <button className="button small secondary" disabled={Boolean(busy)||month===currentMonth()} onClick={()=>setMonth(currentMonth())}>Bieżący</button>
      </div>
      <label className="invoice-search"><Search size={15}/><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Szukaj faktury, dostawcy, zlecenia…"/></label>
      <button className="button small primary" disabled={Boolean(busy)||!invoices.length} onClick={()=>void downloadAll()}><Download size={14}/>{busy==='all'?'Pobieranie…':'Pobierz miesiąc'}</button>
    </div>

    {error&&<div className="service-inline-error">{error}</div>}
    {notice&&<div className="service-inline-success">{notice}</div>}

    <div className="invoice-warehouse-summary invoice-warehouse-summary-v2">
      <article><span>Dokumenty</span><strong>{invoices.length}</strong><small>{filtered.length!==invoices.length?'Widoczne po filtrze: '+filtered.length:'W '+monthLabel(month)}</small></article>
      <article><span>Łączna wartość</span><strong>{money(fullTotal)}</strong><small>{query.trim()?'Widoczne: '+money(total):'Kwoty opisanych faktur'}</small></article>
      <article><span>Dostawcy</span><strong>{suppliers}</strong><small>Unikalni w tym miesiącu</small></article>
    </div>

    <div className="invoice-warehouse-list invoice-warehouse-list-v2">
      {filtered.map((invoice)=><article key={invoice.id}>
        <div className="invoice-file-icon"><FileText size={19}/></div>
        <div className="invoice-file-main">
          <div className="invoice-file-title">
            <strong>{invoice.invoiceNumber||invoice.fileName}</strong>
            {invoice.orderNumber!=null&&<b>#{invoice.orderNumber}</b>}
          </div>
          <span>{invoice.device||'Urządzenie'}{invoice.customerName?' · '+invoice.customerName:''}</span>
          <small>{invoice.supplier||'Brak dostawcy'}{invoice.invoiceDate?' · '+new Date(invoice.invoiceDate+'T12:00:00').toLocaleDateString('pl-PL'):''}{invoice.grossAmount!=null?' · '+money(invoice.grossAmount):''} · {(invoice.sizeBytes/1024/1024).toFixed(2)} MB</small>
        </div>
        <div className="invoice-file-actions">
          <button disabled={Boolean(busy)} title="Pobierz PDF" onClick={()=>void download(invoice)}><Download size={15}/></button>
          <button disabled={Boolean(busy)} title="Usuń fakturę" onClick={()=>void remove(invoice)}><Trash2 size={15}/></button>
        </div>
      </article>)}
      {!busy&&!filtered.length&&<div className="service-history-empty">{invoices.length?'Brak faktur pasujących do wyszukiwania.':'W tym miesiącu nie ma zapisanych faktur PDF.'}</div>}
    </div>
  </section>;
}
