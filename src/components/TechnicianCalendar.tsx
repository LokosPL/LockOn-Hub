import { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays, ChevronLeft, ChevronRight, Clock3, GripVertical, PackageCheck,
  RefreshCw, Smartphone, Wrench
} from 'lucide-react';
import type { ServiceOrderSummary, TechnicianWorkspace } from '../types/electron';

interface Props { onOpenOrder:(order:ServiceOrderSummary)=>void; }

const pad=(value:number)=>String(value).padStart(2,'0');
const dayKey=(value:Date)=>`${value.getFullYear()}-${pad(value.getMonth()+1)}-${pad(value.getDate())}`;
const shortDay=(value:Date)=>value.toLocaleDateString('pl-PL',{weekday:'short'});
const dayNumber=(value:Date)=>value.toLocaleDateString('pl-PL',{day:'2-digit'});
const fullDateLabel=(value:Date)=>value.toLocaleDateString('pl-PL',{weekday:'long',day:'2-digit',month:'long'});
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
  const [selectedDayKey,setSelectedDayKey]=useState(()=>dayKey(new Date()));

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

  useEffect(()=>{
    const keys=days.map(dayKey);
    if(!keys.includes(selectedDayKey))setSelectedDayKey(keys[0]);
  },[days,selectedDayKey]);

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
    for(const items of result.values()){
      items.sort((a,b)=>(a.workflow?.sortRank??50)-(b.workflow?.sortRank??50)||((a.orderNumber??0)-(b.orderNumber??0)));
    }
    return result;
  },[data]);

  const selectedDate=days.find((day)=>dayKey(day)===selectedDayKey)??days[0];
  const selectedOrders=dated.get(selectedDayKey)??[];
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
      if(targetKey)setSelectedDayKey(targetKey);
      setNotice(targetKey
        ?`#${updated.orderNumber} przeniesiono na ${new Date(targetKey+'T12:00:00').toLocaleDateString('pl-PL')}.`
        :`#${updated.orderNumber} przeniesiono do „Bez terminu”.`);
    }catch(reason){setError(reason instanceof Error?reason.message:'Nie udało się zmienić terminu.');}
    finally{setMovingId('');setDraggingId('');setDropKey('');}
  };

  const weekEnd=days[6];
  const isCurrentWeek=dayKey(startOfWeek())===dayKey(weekStart);
  const shiftWeek=(daysToAdd:number)=>{
    setWeekStart((current)=>{
      const next=new Date(current);next.setDate(next.getDate()+daysToAdd);return next;
    });
  };
  const goToday=()=>{
    setWeekStart(startOfWeek());
    setSelectedDayKey(dayKey(new Date()));
  };

  const dropHandlers=(target:string|null)=>({
    onDragOver:(event:React.DragEvent)=>{event.preventDefault();if(draggingId)setDropKey(target??'NO_DATE');},
    onDragLeave:()=>{if(dropKey===(target??'NO_DATE'))setDropKey('');},
    onDrop:(event:React.DragEvent)=>{
      event.preventDefault();
      const id=event.dataTransfer.getData('text/service-order')||draggingId;
      void moveOrder(id,target);
    }
  });

  return <section className="technician-calendar-card technician-calendar-hotfix technician-calendar-v2">
    <header className="technician-calendar-top">
      <div className="technician-calendar-title">
        <span className="eyebrow"><CalendarDays size={13}/> PLAN PRACY</span>
        <div>
          <h2>{new Date(weekStart).toLocaleDateString('pl-PL',{day:'2-digit',month:'short'})} – {new Date(weekEnd).toLocaleDateString('pl-PL',{day:'2-digit',month:'short',year:'numeric'})}</h2>
          <small>Wybierz dzień. Przeciągnij kartę na inną datę u góry, aby zmienić termin.</small>
        </div>
      </div>
      <div className="technician-calendar-toolbar">
        <button className="button small secondary" onClick={()=>shiftWeek(-7)} title="Poprzedni tydzień"><ChevronLeft size={15}/></button>
        <button className="button small secondary" disabled={isCurrentWeek&&selectedDayKey===dayKey(new Date())} onClick={goToday}>Dzisiaj</button>
        <button className="button small secondary" onClick={()=>shiftWeek(7)} title="Następny tydzień"><ChevronRight size={15}/></button>
        <button className="button small secondary" disabled={busy} onClick={()=>void load()} title="Odśwież"><RefreshCw className={busy?'spin':''} size={14}/></button>
      </div>
    </header>

    {error&&<div className="service-inline-error">{error}</div>}
    {notice&&<div className="service-inline-success">{notice}</div>}

    <div className="technician-kpi-strip technician-kpi-strip-v2">
      <div><Smartphone size={15}/><span>Aktywne</span><strong>{data?.counts.active??0}</strong></div>
      <div><Wrench size={15}/><span>W naprawie</span><strong>{data?.counts.inRepair??0}</strong></div>
      <div><Clock3 size={15}/><span>Czeka na części</span><strong>{data?.counts.waitingParts??0}</strong></div>
      <div><PackageCheck size={15}/><span>Do odbioru</span><strong>{data?.counts.readyForPickup??0}</strong></div>
    </div>

    <nav className="technician-week-rail" aria-label="Dni tygodnia">
      {days.map((day)=>{
        const key=dayKey(day);
        const count=(dated.get(key)??[]).length;
        const today=key===dayKey(new Date());
        const selected=key===selectedDayKey;
        return <button
          type="button"
          key={key}
          className={(selected?'selected ':'')+(today?'today ':'')+(dropKey===key?'drop-target':'')}
          onClick={()=>setSelectedDayKey(key)}
          {...dropHandlers(key)}
        >
          <span>{shortDay(day)}</span>
          <strong>{dayNumber(day)}</strong>
          <small>{count===1?'1 zlecenie':`${count} zleceń`}</small>
        </button>;
      })}
    </nav>

    <div className="technician-day-focus">
      <header>
        <div>
          <span>WYBRANY DZIEŃ</span>
          <h3>{fullDateLabel(selectedDate)}</h3>
        </div>
        <b>{selectedOrders.length}</b>
      </header>
      <div className="technician-day-focus-list">
        {selectedOrders.map((order)=><button
          key={order.id}
          draggable={!movingId}
          onDragStart={(event)=>{event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/service-order',order.id);setDraggingId(order.id);}}
          onDragEnd={()=>{setDraggingId('');setDropKey('');}}
          onClick={()=>onOpenOrder(order)}
          className={'technician-job-focus '+statusClass(order.status)+(draggingId===order.id?' dragging':'')}
          disabled={movingId===order.id}
        >
          <GripVertical size={14}/>
          <div className="technician-job-focus-number">#{order.orderNumber}</div>
          <div className="technician-job-focus-main">
            <strong>{order.brand} {order.model}</strong>
            <span>{order.customerName}</span>
          </div>
          <div className="technician-job-focus-status">
            <strong>{order.workflow?.attentionLabel||order.statusLabel}</strong>
            <small>{order.workflow?.nextAction||'Otwórz szczegóły zlecenia'}</small>
          </div>
        </button>)}
        {!selectedOrders.length&&<div className="technician-day-focus-empty"><CalendarDays size={24}/><strong>Ten dzień jest wolny</strong><span>Przeciągnij tutaj zlecenie z innego terminu albo ustaw datę w szczegółach.</span></div>}
      </div>
    </div>

    <div className="technician-queue-strip technician-queue-strip-v2">
      <section>
        <header><span>Czeka na części</span><b>{waitingParts.length}</b></header>
        <div>{waitingParts.slice(0,6).map((order)=><button key={order.id} onClick={()=>onOpenOrder(order)}>#{order.orderNumber} · {order.brand} {order.model}</button>)}
        {!waitingParts.length&&<small>Brak urządzeń</small>}</div>
      </section>
      <section>
        <header><span>Gotowe do odbioru</span><b>{ready.length}</b></header>
        <div>{ready.slice(0,6).map((order)=><button key={order.id} onClick={()=>onOpenOrder(order)}>#{order.orderNumber} · {order.brand} {order.model}</button>)}
        {!ready.length&&<small>Brak urządzeń</small>}</div>
      </section>
      <section className={dropKey==='NO_DATE'?'drop-target':''} {...dropHandlers(null)}>
        <header><span>Bez terminu</span><b>{backlog.length}</b></header>
        <div>{backlog.slice(0,6).map((order)=><button
          key={order.id}
          draggable={!movingId}
          onDragStart={(event)=>{event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/service-order',order.id);setDraggingId(order.id);}}
          onDragEnd={()=>{setDraggingId('');setDropKey('');}}
          onClick={()=>onOpenOrder(order)}
        >#{order.orderNumber} · {order.brand} {order.model}</button>)}
        {!backlog.length&&<small>{dropKey==='NO_DATE'?'Upuść tutaj':'Brak urządzeń'}</small>}</div>
      </section>
    </div>
  </section>;
}
