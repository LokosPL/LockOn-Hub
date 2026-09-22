import { useEffect, useMemo, useState } from 'react';
import {
  Building2, CalendarDays, ChevronLeft, ChevronRight, Download, FileArchive,
  FileText, RefreshCw, Search, Trash2
} from 'lucide-react';
import type { ServiceInvoice } from '../types/electron';
import { useAppDialog } from './AppDialog';

interface WarehousePoint { id:string; name:string; city?:string; }
interface Props { pointId:string; pointName:string; points?:WarehousePoint[]; onPointChange?:(pointId:string)=>void; }

const monthKey=(date:Date)=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
const currentMonth=()=>monthKey(new Date());
const money=(value:number)=>new Intl.NumberFormat('pl-PL',{style:'currency',currency:'PLN'}).format(value);
const monthLabel=(value:string)=>{const [year,month]=value.split('-').map(Number);return year&&month?new Date(year,month-1,1).toLocaleDateString('pl-PL',{month:'long',year:'numeric'}):value;};
const shiftMonth=(value:string,delta:number)=>{const [year,month]=value.split('-').map(Number);return monthKey(new Date(year||new Date().getFullYear(),(month||1)-1+delta,1));};

export function InvoiceWarehouse({pointId,pointName,points=[],onPointChange}:Props){
  const {confirm}=useAppDialog();
  const [month,setMonth]=useState(currentMonth);
  const [invoices,setInvoices]=useState<ServiceInvoice[]>([]);
  const [query,setQuery]=useState('');
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');

  const load=async()=>{
    if(busy||!pointId)return;
    setBusy('load');setError('');
    try{const result=await window.lockOn.service.listInvoices(month,pointId);setInvoices(result.invoices);}
    catch(reason){setError(reason instanceof Error?reason.message:'Nie udało się pobrać magazynu faktur.');}
    finally{setBusy('');}
  };
  useEffect(()=>{void load();},[month,pointId]);

  const visible=useMemo(()=>{
    const term=query.trim().toLocaleLowerCase('pl-PL');
    const sorted=[...invoices].sort((a,b)=>String(b.invoiceDate||b.createdAt).localeCompare(String(a.invoiceDate||a.createdAt)));
    if(!term)return sorted;
    return sorted.filter((invoice)=>[invoice.invoiceNumber,invoice.fileName,invoice.supplier,invoice.customerName,invoice.device,invoice.orderNumber].some((value)=>String(value||'').toLocaleLowerCase('pl-PL').includes(term)));
  },[invoices,query]);
  const total=useMemo(()=>invoices.reduce((sum,item)=>sum+(item.grossAmount||0),0),[invoices]);
  const suppliers=useMemo(()=>new Set(invoices.map((item)=>item.supplier?.trim()).filter(Boolean)).size,[invoices]);

  const download=async(invoice:ServiceInvoice)=>{
    if(busy)return;setBusy(invoice.id);setError('');
    try{const result=await window.lockOn.service.downloadInvoice(invoice.id);if(!result.cancelled)setNotice('Faktura pobrana.');}
    catch(reason){setError(reason instanceof Error?reason.message:'Nie udało się pobrać faktury.');}
    finally{setBusy('');}
  };
  const downloadAll=async()=>{
    if(busy||!invoices.length||!pointId)return;setBusy('all');setError('');
    try{const result=await window.lockOn.service.downloadInvoiceBatch(month,pointId);if(!result.cancelled)setNotice(`Pobrano ${result.downloaded} faktur.`);}
    catch(reason){setError(reason instanceof Error?reason.message:'Nie udało się pobrać miesiąca.');}
    finally{setBusy('');}
  };
  const remove=async(invoice:ServiceInvoice)=>{
    if(busy)return;
    if(!await confirm({
      title:'Usunąć fakturę z magazynu?',
      message:invoice.fileName,
      detail:`Dokument zostanie usunięty z magazynu punktu ${pointName}. Ta operacja nie usuwa samego zlecenia.`,
      confirmLabel:'Usuń fakturę',tone:'danger'
    }))return;
    setBusy('delete:'+invoice.id);setError('');
    try{await window.lockOn.service.deleteInvoice(invoice.id);setInvoices((current)=>current.filter((item)=>item.id!==invoice.id));setNotice('Faktura usunięta.');}
    catch(reason){setError(reason instanceof Error?reason.message:'Nie udało się usunąć faktury.');}
    finally{setBusy('');}
  };

  return <section className="invoice-shell">
    <header className="invoice-head">
      <div>
        <span className="eyebrow"><FileArchive size={13}/> MAGAZYN FAKTUR</span>
        <h2>Faktury przypisane do konkretnego punktu.</h2>
        <p>Każdy punkt ma własny magazyn. Dokument zlecenia trafia do punktu, w którym zlecenie zostało przyjęte.</p>
      </div>
      <div className="invoice-current-point"><Building2 size={17}/><span>MAGAZYN</span><strong>{pointName||'—'}</strong></div>
    </header>

    {points.length>1&&<nav className="invoice-point-tabs" aria-label="Magazyny punktów">
      {points.map((point)=><button key={point.id} className={point.id===pointId?'active':''} disabled={Boolean(busy)} onClick={()=>onPointChange?.(point.id)}>
        <Building2 size={14}/><span><strong>{point.name}</strong>{point.city&&<small>{point.city}</small>}</span>
      </button>)}
    </nav>}

    <div className="invoice-stats">
      <article><span>Dokumenty</span><strong>{invoices.length}</strong><small>{monthLabel(month)}</small></article>
      <article><span>Łączna wartość</span><strong>{money(total)}</strong><small>brutto</small></article>
      <article><span>Dostawcy</span><strong>{suppliers}</strong><small>w tym miesiącu</small></article>
    </div>

    <div className="invoice-toolbar-clean-v3">
      <div className="invoice-month-controls">
        <button onClick={()=>setMonth((value)=>shiftMonth(value,-1))} disabled={Boolean(busy)}><ChevronLeft size={15}/></button>
        <label><CalendarDays size={14}/><input type="month" value={month} onChange={(e)=>setMonth(e.target.value)}/></label>
        <button onClick={()=>setMonth((value)=>shiftMonth(value,1))} disabled={Boolean(busy)}><ChevronRight size={15}/></button>
        <button className="text" onClick={()=>setMonth(currentMonth())} disabled={Boolean(busy)||month===currentMonth()}>Bieżący</button>
      </div>
      <label className="invoice-search-v3"><Search size={15}/><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Szukaj numeru, dostawcy, klienta…"/></label>
      <button className="button small secondary" onClick={()=>void load()} disabled={Boolean(busy)}><RefreshCw size={14} className={busy==='load'?'spin':''}/></button>
      <button className="button small primary" onClick={()=>void downloadAll()} disabled={Boolean(busy)||!invoices.length}><Download size={14}/>{busy==='all'?'Pobieram…':'Pobierz miesiąc'}</button>
    </div>

    {error&&<div className="service-inline-error">{error}</div>}
    {notice&&<div className="service-inline-success">{notice}</div>}

    <div className="invoice-list-v3">
      {visible.map((invoice)=><article key={invoice.id}>
        <div className="invoice-file-v3"><span><FileText size={17}/></span><div><strong>{invoice.invoiceNumber||'Faktura bez numeru'}</strong><small>{invoice.fileName}</small></div></div>
        <div className="invoice-order-v3"><span>Zlecenie</span><strong>{invoice.orderNumber!=null?'#'+invoice.orderNumber:'—'}</strong><small>{invoice.device||'Urządzenie'}{invoice.customerName?' · '+invoice.customerName:''}</small></div>
        <div className="invoice-supplier-v3"><span>Dostawca</span><strong>{invoice.supplier||'Nie podano'}</strong><small>{invoice.invoiceDate?new Date(invoice.invoiceDate+'T12:00:00').toLocaleDateString('pl-PL'):'Brak daty'}</small></div>
        <div className="invoice-value-v3"><span>Brutto</span><strong>{invoice.grossAmount!=null?money(invoice.grossAmount):'—'}</strong></div>
        <div className="invoice-actions-v3"><button title="Pobierz PDF" disabled={Boolean(busy)} onClick={()=>void download(invoice)}><Download size={15}/></button><button title="Usuń" disabled={Boolean(busy)} onClick={()=>void remove(invoice)}><Trash2 size={15}/></button></div>
      </article>)}
      {!busy&&!visible.length&&<div className="invoice-empty-v3"><FileArchive size={30}/><strong>{invoices.length?'Brak wyników':'Ten magazyn jest pusty'}</strong><span>{invoices.length?'Wyczyść wyszukiwanie.':`Faktury z punktu „${pointName}” pojawią się tutaj automatycznie.`}</span></div>}
    </div>
  </section>;
}
