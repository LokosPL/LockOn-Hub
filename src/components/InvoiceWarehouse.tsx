import { useEffect, useMemo, useState } from 'react';
import { Building2, CalendarDays, ChevronLeft, ChevronRight, Download, FileArchive, FileText, RefreshCw, Search, Trash2 } from 'lucide-react';
import type { ServiceInvoice } from '../types/electron';

interface Props { pointId:string; pointName:string; }

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

export function InvoiceWarehouse({pointId,pointName}:Props){
  const [month,setMonth]=useState(currentMonth);
  const [invoices,setInvoices]=useState<ServiceInvoice[]>([]);
  const [query,setQuery]=useState('');
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');

  const load=async()=>{
    if(busy||!pointId)return;
    setBusy('load');setError('');
    try{
      const result=await window.lockOn.service.listInvoices(month,pointId);
      setInvoices(result.invoices);
    }catch(reason){setError(reason instanceof Error?reason.message:'Nie udało się pobrać magazynu faktur.');}
    finally{setBusy('');}
  };
  useEffect(()=>{void load();},[month,pointId]);

  const filtered=useMemo(()=>{
    const term=query.trim().toLocaleLowerCase('pl-PL');
    const sorted=[...invoices].sort((a,b)=>String(b.invoiceDate||b.createdAt).localeCompare(String(a.invoiceDate||a.createdAt)));
    if(!term)return sorted;
    return sorted.filter((invoice)=>[
      invoice.invoiceNumber,invoice.fileName,invoice.supplier,invoice.customerName,invoice.device,
      invoice.orderNumber==null?'':String(invoice.orderNumber)
    ].some((value)=>String(value||'').toLocaleLowerCase('pl-PL').includes(term)));
  },[invoices,query]);

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
    if(busy||!invoices.length||!pointId)return;
    setBusy('all');setError('');setNotice('');
    try{
      const result=await window.lockOn.service.downloadInvoiceBatch(month,pointId);
      if(result.cancelled)return;
      setNotice('Pobrano '+result.downloaded+' faktur'+(result.failed?'. Nie udało się pobrać: '+result.failed+'.':' do wybranego folderu.'));
    }catch(reason){setError(reason instanceof Error?reason.message:'Nie udało się pobrać paczki faktur.');}
    finally{setBusy('');}
  };

  const remove=async(invoice:ServiceInvoice)=>{
    if(busy)return;
    if(!window.confirm('Usunąć fakturę „'+invoice.fileName+'” z magazynu punktu?'))return;
    setBusy('delete:'+invoice.id);setError('');setNotice('');
    try{
      await window.lockOn.service.deleteInvoice(invoice.id);
      setInvoices((current)=>current.filter((item)=>item.id!==invoice.id));
      setNotice('Faktura została usunięta.');
    }catch(reason){setError(reason instanceof Error?reason.message:'Nie udało się usunąć faktury.');}
    finally{setBusy('');}
  };

  return <section className="invoice-warehouse invoice-warehouse-hotfix">
    <header className="invoice-warehouse-top">
      <div>
        <span className="eyebrow"><FileArchive size={13}/> MAGAZYN FAKTUR</span>
        <h2>Faktury części · {pointName||'aktywny punkt'}</h2>
        <p>Każdy punkt ma osobny magazyn. Tutaj widzisz tylko dokumenty przypisane do zleceń tego punktu.</p>
      </div>
      <div className="invoice-point-badge"><Building2 size={15}/><span>Magazyn punktu</span><strong>{pointName||'—'}</strong></div>
    </header>

    <div className="invoice-control-bar">
      <div className="invoice-month-nav-clean">
        <button className="button small secondary" disabled={Boolean(busy)} onClick={()=>setMonth((value)=>shiftMonth(value,-1))}><ChevronLeft size={15}/></button>
        <label><CalendarDays size={14}/><input type="month" value={month} onChange={(e)=>setMonth(e.target.value)} disabled={Boolean(busy)}/></label>
        <button className="button small secondary" disabled={Boolean(busy)} onClick={()=>setMonth((value)=>shiftMonth(value,1))}><ChevronRight size={15}/></button>
        <button className="button small secondary" disabled={Boolean(busy)||month===currentMonth()} onClick={()=>setMonth(currentMonth())}>Dzisiaj</button>
      </div>
      <label className="invoice-search-clean"><Search size={15}/><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Numer faktury, dostawca, klient, zlecenie…"/></label>
      <button className="button small secondary" disabled={Boolean(busy)} onClick={()=>void load()}><RefreshCw className={busy==='load'?'spin':''} size={14}/></button>
      <button className="button small primary" disabled={Boolean(busy)||!invoices.length} onClick={()=>void downloadAll()}><Download size={14}/>{busy==='all'?'Pobieranie…':'Pobierz miesiąc'}</button>
    </div>

    {error&&<div className="service-inline-error">{error}</div>}
    {notice&&<div className="service-inline-success">{notice}</div>}

    <div className="invoice-summary-clean">
      <article><span>Dokumenty</span><strong>{invoices.length}</strong><small>{monthLabel(month)}</small></article>
      <article><span>Wartość brutto</span><strong>{money(fullTotal)}</strong><small>z wpisanymi kwotami</small></article>
      <article><span>Dostawcy</span><strong>{suppliers}</strong><small>unikalni w miesiącu</small></article>
      <article><span>Po filtrze</span><strong>{filtered.length}</strong><small>{query.trim()?'wyników':'bez filtra'}</small></article>
    </div>

    <div className="invoice-table-clean">
      <header><span>Dokument</span><span>Zlecenie / klient</span><span>Dostawca / data</span><span>Kwota</span><span></span></header>
      {filtered.map((invoice)=><article key={invoice.id}>
        <div className="invoice-document-cell"><i><FileText size={18}/></i><span><strong>{invoice.invoiceNumber||invoice.fileName}</strong><small>{invoice.fileName} · {(invoice.sizeBytes/1024/1024).toFixed(2)} MB</small></span></div>
        <div><strong>{invoice.orderNumber!=null?'#'+invoice.orderNumber:'Bez numeru'}</strong><small>{invoice.device||'Urządzenie'}{invoice.customerName?' · '+invoice.customerName:''}</small></div>
        <div><strong>{invoice.supplier||'Nie podano'}</strong><small>{invoice.invoiceDate?new Date(invoice.invoiceDate+'T12:00:00').toLocaleDateString('pl-PL'):'Brak daty'}</small></div>
        <div className="invoice-amount-cell"><strong>{invoice.grossAmount!=null?money(invoice.grossAmount):'—'}</strong></div>
        <div className="invoice-row-actions">
          <button disabled={Boolean(busy)} title="Pobierz PDF" onClick={()=>void download(invoice)}><Download size={15}/></button>
          <button disabled={Boolean(busy)} title="Usuń fakturę" onClick={()=>void remove(invoice)}><Trash2 size={15}/></button>
        </div>
      </article>)}
      {!busy&&!filtered.length&&<div className="invoice-empty-clean"><FileArchive size={24}/><strong>{invoices.length?'Brak wyników':'Brak faktur w tym miesiącu'}</strong><span>{invoices.length?'Zmień wyszukiwanie.':'Faktury dodane do zleceń tego punktu pojawią się tutaj.'}</span></div>}
    </div>
  </section>;
}
