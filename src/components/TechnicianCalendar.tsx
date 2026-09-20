import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Clock3, PackageCheck, RefreshCw, Smartphone, Wrench } from 'lucide-react';
import type { ServiceOrderSummary, TechnicianWorkspace } from '../types/electron';

interface Props { onOpenOrder:(order:ServiceOrderSummary)=>void; }

const dayKey=(value:Date)=>value.toISOString().slice(0,10);
const dateLabel=(value:Date)=>value.toLocaleDateString('pl-PL',{weekday:'short',day:'2-digit',month:'2-digit'});
const statusClass=(status:string)=>status.toLowerCase().replace(/_/g,'-');

export function TechnicianCalendar({onOpenOrder}:Props){
  const [data,setData]=useState<TechnicianWorkspace|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');

  const load=async()=>{
    if(busy)return;
    setBusy(true);setError('');
    try{setData(await window.lockOn.service.getTechnicianWorkspace());}
    catch(reason){setError(reason instanceof Error?reason.message:'Nie udało się pobrać planu serwisanta.');}
    finally{setBusy(false);}
  };

  useEffect(()=>{
    void load();
    const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void load();},30000);
    return()=>window.clearInterval(timer);
  },[]);

  const days=useMemo(()=>Array.from({length:7},(_,index)=>{
    const date=new Date();date.setHours(0,0,0,0);date.setDate(date.getDate()+index);return date;
  }),[]);

  const dated=useMemo(()=>{
    const result=new Map<string,ServiceOrderSummary[]>();
    for(const order of data?.orders??[]){
      if(!order.estimatedCompletionAt)continue;
      const date=new Date(order.estimatedCompletionAt);
      if(Number.isNaN(date.getTime()))continue;
      const key=dayKey(date);
      result.set(key,[...(result.get(key)??[]),order]);
    }
    return result;
  },[data]);

  const backlog=(data?.orders??[]).filter((order)=>!order.estimatedCompletionAt);
  const waitingParts=(data?.orders??[]).filter((order)=>order.status==='WAITING_PARTS');
  const ready=(data?.orders??[]).filter((order)=>['REPAIR_DONE','READY'].includes(order.status));

  return <section className="panel-card technician-calendar-card">
    <div className="panel-heading">
      <div><span className="eyebrow"><CalendarDays size={13}/> MÓJ PLAN PRACY</span><h2>Telefony do zrobienia</h2><p>Twój osobisty kalendarz pokazuje wyłącznie naprawy przypisane do Twojego konta.</p></div>
      <button className="button small secondary" disabled={busy} onClick={()=>void load()}><RefreshCw className={busy?'spin':''} size={14}/> Odśwież</button>
    </div>
    {error&&<div className="service-inline-error">{error}</div>}
    <div className="technician-kpi-grid">
      <article><Smartphone size={17}/><span>Aktywne</span><strong>{data?.counts.active??0}</strong></article>
      <article><Wrench size={17}/><span>W naprawie</span><strong>{data?.counts.inRepair??0}</strong></article>
      <article><Clock3 size={17}/><span>Czeka na części</span><strong>{data?.counts.waitingParts??0}</strong></article>
      <article><PackageCheck size={17}/><span>Do odbioru</span><strong>{data?.counts.readyForPickup??0}</strong></article>
    </div>

    <div className="technician-week-grid">
      {days.map((day)=>{
        const items=dated.get(dayKey(day))??[];
        return <div className="technician-day" key={dayKey(day)}>
          <header><strong>{dateLabel(day)}</strong><span>{items.length}</span></header>
          <div>
            {items.map((order)=><button key={order.id} onClick={()=>onOpenOrder(order)} className={'technician-job '+statusClass(order.status)}>
              <span>#{order.orderNumber} · {order.brand} {order.model}</span>
              <strong>{order.customerName}</strong>
              <small>{order.statusLabel}{order.estimatedCompletionAt?' · '+new Date(order.estimatedCompletionAt).toLocaleTimeString('pl-PL',{hour:'2-digit',minute:'2-digit'}):''}</small>
            </button>)}
            {!items.length&&<small className="technician-day-empty">Brak terminu</small>}
          </div>
        </div>;
      })}
    </div>

    <div className="technician-queues">
      <section>
        <h3>Czeka na części <b>{waitingParts.length}</b></h3>
        {waitingParts.slice(0,12).map((order)=><button key={order.id} onClick={()=>onOpenOrder(order)}><span>#{order.orderNumber}</span><strong>{order.brand} {order.model}</strong><small>{order.customerName}</small></button>)}
        {!waitingParts.length&&<div className="service-history-empty">Nic nie czeka na części.</div>}
      </section>
      <section>
        <h3>Gotowe / czeka na odbiór <b>{ready.length}</b></h3>
        {ready.slice(0,12).map((order)=><button key={order.id} onClick={()=>onOpenOrder(order)}><span>#{order.orderNumber}</span><strong>{order.brand} {order.model}</strong><small>{order.customerName}</small></button>)}
        {!ready.length&&<div className="service-history-empty">Brak telefonów czekających na odbiór.</div>}
      </section>
      <section>
        <h3>Bez terminu <b>{backlog.length}</b></h3>
        {backlog.slice(0,12).map((order)=><button key={order.id} onClick={()=>onOpenOrder(order)}><span>#{order.orderNumber}</span><strong>{order.brand} {order.model}</strong><small>{order.statusLabel}</small></button>)}
        {!backlog.length&&<div className="service-history-empty">Wszystkie aktywne naprawy mają termin.</div>}
      </section>
    </div>
  </section>;
}
