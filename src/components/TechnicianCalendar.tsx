import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, GripVertical, PackageCheck, RefreshCw, Smartphone, Wrench } from 'lucide-react';
import type { ServiceOrderSummary, TechnicianWorkspace } from '../types/electron';

interface Props { onOpenOrder:(order:ServiceOrderSummary)=>void; }

const pad=(value:number)=>String(value).padStart(2,'0');
const dayKey=(value:Date)=>`${value.getFullYear()}-${pad(value.getMonth()+1)}-${pad(value.getDate())}`;
const dateLabel=(value:Date)=>value.toLocaleDateString('pl-PL',{weekday:'short',day:'2-digit',month:'2-digit'});
const fullDateLabel=(value:Date)=>value.toLocaleDateString('pl-PL',{day:'2-digit',month:'long'});
const statusClass=(status:string)=>status.toLowerCase().replace(/_/g,'-');

const startOfWeek=(source=new Date())=>{
  const date=new Date(source);
  date.setHours(0,0,0,0);
  const weekday=(date.getDay()+6)%7;
  date.setDate(date.getDate()-weekday);
  return date;
};

const apiDate=(key:string)=>{
  const date=new Date(key+'T12:00:00');
  return Number.isNaN(date.getTime())?null:date.toISOString();
};

export function TechnicianCalendar({onOpenOrder}:Props){
  const [data,setData]=useState<TechnicianWorkspace|null>(null);
  const [busy,setBusy]=useState(false);
  const [movingId,setMovingId]=useState('');
  const [draggingId,setDraggingId]=useState('');
  const [dropKey,setDropKey]=useState('');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [weekStart,setWeekStart]=useState(()=>startOfWeek());

  const load=async()=>{
    if(busy)return;
    setBusy(true);setError('');
    try{setData(await window.lockOn.service.getTechnicianWorkspace());}
    catch(reason){setError(reason instanceof Error?reason.message:'Nie udało się pobrać planu serwisanta.');}
    finally{setBusy(false);}
  };

  useEffect(()=>{
    void load();
    const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void load();},90000);
    return()=>window.clearInterval(timer);
  },[]);

  const days=useMemo(()=>Array.from({length:7},(_,index)=>{
    const date=new Date(weekStart);date.setDate(date.getDate()+index);return date;
  }),[weekStart]);

  const dated=useMemo(()=>{
    const result=new Map<string,ServiceOrderSummary[]>();
    for(const order of data?.orders??[]){
      if(!order.estimatedCompletionAt)continue;
      const date=new Date(order.estimatedCompletionAt);
      if(Number.isNaN(date.getTime()))continue;
      const key=dayKey(date);
      const list=result.get(key);
      if(list)list.push(order);else result.set(key,[order]);
    }
    for(const items of result.values())items.sort((a,b)=>(a.workflow?.sortRank??50)-(b.workflow?.sortRank??50)||((a.orderNumber??0)-(b.orderNumber??0)));
    return result;
  },[data]);

  const backlog=useMemo(()=>(data?.orders??[]).filter((order)=>!order.estimatedCompletionAt),[data]);
  const waitingParts=useMemo(()=>(data?.orders??[]).filter((order)=>order.status==='WAITING_PARTS'),[data]);
  const ready=useMemo(()=>(data?.orders??[]).filter((order)=>['REPAIR_DONE','READY'].includes(order.status)),[data]);

  const moveOrder=async(orderId:string,targetKey:string|null)=>{
    if(movingId)return;
    const current=data?.orders.find((item)=>item.id===orderId);
    if(!current)return;
    const currentKey=current.estimatedCompletionAt?dayKey(new Date(current.estimatedCompletionAt)):'';
    if((targetKey??'')===currentKey){setDraggingId('');setDropKey('');return;}
    setMovingId(orderId);setError('');setNotice('');
    try{
      const updated=await window.lockOn.service.updateDetails(orderId,{estimatedCompletionAt:targetKey?apiDate(targetKey):null});
      setData((state)=>state?{...state,orders:state.orders.map((item)=>item.id===orderId?{...item,...updated}:item)}:state);
      setNotice(targetKey?`Termin zlecenia #${updated.orderNumber} ustawiony na ${new Date(targetKey+'T12:00:00').toLocaleDateString('pl-PL')}.`:`Usunięto termin ze zlecenia #${updated.orderNumber}.`);
    }catch(reason){setError(reason instanceof Error?reason.message:'Nie udało się zmienić terminu.');}
    finally{setMovingId('');setDraggingId('');setDropKey('');}
  };

  const weekEnd=days[6];
  const isCurrentWeek=dayKey(startOfWeek())===dayKey(weekStart);
  const shiftWeek=(daysToAdd:number)=>setWeekStart((current)=>{const next=new Date(current);next.setDate(next.getDate()+daysToAdd);return next;});

  return <section className="panel-card technician-calendar-card technician-calendar-v2">
    <div className="panel-heading technician-calendar-heading">
      <div>
        <span className="eyebrow"><CalendarDays size={13}/> MÓJ PLAN PRACY</span>
        <h2>Kalendarz napraw</h2>
        <p>Przeciągnij telefon na inny dzień, aby zmienić przewidywany termin. Bez dodatkowych okien i ciężkich animacji.</p>
      </div>
      <div className="technician-calendar-toolbar">
        <button className="button small secondary" onClick={()=>shiftWeek(-7)} title="Poprzedni tydzień"><ChevronLeft size={15}/></button>
        <button className="button small secondary" disabled={isCurrentWeek} onClick={()=>setWeekStart(startOfWeek())}>Dzisiaj</button>
        <button className="button small secondary" onClick={()=>shiftWeek(7)} title="Następny tydzień"><ChevronRight size={15}/></button>
        <button className="button small secondary" disabled={busy} onClick={()=>void load()}><RefreshCw className={busy?'spin':''} size={14}/> Odśwież</button>
      </div>
    </div>

    <div className="technician-calendar-range">
      <strong>{fullDateLabel(weekStart)} – {fullDateLabel(weekEnd)}</strong>
      <span>Upuść kartę na wybranym dniu. Upuszczenie w „Bez terminu” usuwa datę.</span>
    </div>

    {error&&<div className="service-inline-error">{error}</div>}
    {notice&&<div className="service-inline-success">{notice}</div>}

    <div className="technician-kpi-grid">
      <article><Smartphone size={17}/><span>Aktywne</span><strong>{data?.counts.active??0}</strong></article>
      <article><Wrench size={17}/><span>W naprawie</span><strong>{data?.counts.inRepair??0}</strong></article>
      <article><Clock3 size={17}/><span>Czeka na części</span><strong>{data?.counts.waitingParts??0}</strong></article>
      <article><PackageCheck size={17}/><span>Do odbioru</span><strong>{data?.counts.readyForPickup??0}</strong></article>
    </div>

    <div className="technician-week-grid technician-week-grid-v2">
      {days.map((day)=>{
        const key=dayKey(day);
        const items=dated.get(key)??[];
        const today=key===dayKey(new Date());
        return <div
          className={'technician-day '+(today?'today ':'')+(dropKey===key?'drop-target':'')}
          key={key}
          onDragOver={(event)=>{event.preventDefault();if(draggingId)setDropKey(key);}}
          onDragLeave={()=>{if(dropKey===key)setDropKey('');}}
          onDrop={(event)=>{event.preventDefault();const id=event.dataTransfer.getData('text/service-order')||draggingId;void moveOrder(id,key);}}
        >
          <header><div><strong>{dateLabel(day)}</strong>{today&&<small>dzisiaj</small>}</div><span>{items.length}</span></header>
          <div className="technician-day-jobs">
            {items.map((order)=><button
              key={order.id}
              draggable={!movingId}
              onDragStart={(event)=>{event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/service-order',order.id);setDraggingId(order.id);}}
              onDragEnd={()=>{setDraggingId('');setDropKey('');}}
              onClick={()=>onOpenOrder(order)}
              className={'technician-job '+statusClass(order.status)+(draggingId===order.id?' dragging':'')}
              disabled={movingId===order.id}
              title="Kliknij po szczegóły lub przeciągnij na inny dzień"
            >
              <GripVertical size={13} className="technician-job-grip"/>
              <span>#{order.orderNumber} · {order.brand} {order.model}</span>
              <strong>{order.customerName}</strong>
              <small>{order.statusLabel}</small>
            </button>)}
            {!items.length&&<small className="technician-day-empty">{dropKey===key?'Upuść tutaj':'Brak zleceń'}</small>}
          </div>
        </div>;
      })}
    </div>

    <div className="technician-queues technician-queues-v2">
      <section>
        <h3>Czeka na części <b>{waitingParts.length}</b></h3>
        {waitingParts.slice(0,8).map((order)=><button key={order.id} onClick={()=>onOpenOrder(order)}><span>#{order.orderNumber}</span><strong>{order.brand} {order.model}</strong><small>{order.customerName}</small></button>)}
        {!waitingParts.length&&<div className="service-history-empty">Nic nie czeka na części.</div>}
      </section>
      <section>
        <h3>Gotowe / czeka na odbiór <b>{ready.length}</b></h3>
        {ready.slice(0,8).map((order)=><button key={order.id} onClick={()=>onOpenOrder(order)}><span>#{order.orderNumber}</span><strong>{order.brand} {order.model}</strong><small>{order.customerName}</small></button>)}
        {!ready.length&&<div className="service-history-empty">Brak telefonów czekających na odbiór.</div>}
      </section>
      <section
        className={dropKey==='NO_DATE'?'drop-target':''}
        onDragOver={(event)=>{event.preventDefault();if(draggingId)setDropKey('NO_DATE');}}
        onDragLeave={()=>{if(dropKey==='NO_DATE')setDropKey('');}}
        onDrop={(event)=>{event.preventDefault();const id=event.dataTransfer.getData('text/service-order')||draggingId;void moveOrder(id,null);}}
      >
        <h3>Bez terminu <b>{backlog.length}</b></h3>
        {backlog.slice(0,8).map((order)=><button
          key={order.id}
          draggable={!movingId}
          onDragStart={(event)=>{event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/service-order',order.id);setDraggingId(order.id);}}
          onDragEnd={()=>{setDraggingId('');setDropKey('');}}
          onClick={()=>onOpenOrder(order)}
        ><span>#{order.orderNumber}</span><strong>{order.brand} {order.model}</strong><small>{order.statusLabel}</small></button>)}
        {!backlog.length&&<div className="service-history-empty">{dropKey==='NO_DATE'?'Upuść tutaj, aby usunąć termin.':'Wszystkie aktywne naprawy mają termin.'}</div>}
      </section>
    </div>
  </section>;
}
