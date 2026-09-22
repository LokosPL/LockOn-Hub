import { useEffect, useMemo, useState, type DragEvent } from 'react';
import {
  CalendarDays, ChevronLeft, ChevronRight, Clock3, GripVertical, MailCheck, PackageCheck,
  RefreshCw, Smartphone, Wrench
} from 'lucide-react';
import type { ServiceOrderSummary, TechnicianWorkspace } from '../types/electron';

interface Props { onOpenOrder:(order:ServiceOrderSummary)=>void; }

const pad=(value:number)=>String(value).padStart(2,'0');
const dayKey=(value:Date)=>`${value.getFullYear()}-${pad(value.getMonth()+1)}-${pad(value.getDate())}`;
const apiDate=(key:string)=>new Date(key+'T12:00:00').toISOString();
const startOfWeek=(source=new Date())=>{
  const date=new Date(source); date.setHours(0,0,0,0);
  date.setDate(date.getDate()-((date.getDay()+6)%7));
  return date;
};
const device=(order:ServiceOrderSummary)=>[order.brand,order.model].filter(Boolean).join(' ')||'Telefon';
const statusTone=(order:ServiceOrderSummary)=>{
  if(order.workflow?.flags.includes('OVERDUE'))return 'danger';
  if(order.workflow?.flags.includes('DUE_SOON'))return 'warning';
  if(order.workflow?.flags.includes('READY_FOR_PICKUP'))return 'ready';
  return 'default';
};

export function TechnicianCalendar({onOpenOrder}:Props){
  const [data,setData]=useState<TechnicianWorkspace|null>(null);
  const [weekStart,setWeekStart]=useState(()=>startOfWeek());
  const [selected,setSelected]=useState(()=>dayKey(new Date()));
  const [busy,setBusy]=useState(false);
  const [moving,setMoving]=useState('');
  const [dragging,setDragging]=useState('');
  const [dropTarget,setDropTarget]=useState('');
  const [dropIndex,setDropIndex]=useState<number|null>(null);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');

  const load=async()=>{
    if(busy)return;
    setBusy(true);setError('');
    try{setData(await window.lockOn.service.getTechnicianWorkspace());}
    catch(reason){setError(reason instanceof Error?reason.message:'Nie udało się pobrać planu pracy.');}
    finally{setBusy(false);}
  };
  useEffect(()=>{void load();const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void load();},90_000);return()=>window.clearInterval(timer);},[]);

  const days=useMemo(()=>Array.from({length:7},(_,index)=>{const date=new Date(weekStart);date.setDate(date.getDate()+index);return date;}),[weekStart]);
  useEffect(()=>{const keys=days.map(dayKey);if(!keys.includes(selected))setSelected(keys[0]);},[days,selected]);

  const byDay=useMemo(()=>{
    const result=new Map<string,ServiceOrderSummary[]>();
    for(const order of data?.orders??[]){
      if(!order.estimatedCompletionAt)continue;
      const date=new Date(order.estimatedCompletionAt); if(Number.isNaN(date.getTime()))continue;
      const key=dayKey(date); const list=result.get(key)??[]; list.push(order); result.set(key,list);
    }
    for(const list of result.values())list.sort((a,b)=>{
      const aPos=Number(a.planPosition||0),bPos=Number(b.planPosition||0);
      if(aPos||bPos)return (aPos||999999)-(bPos||999999);
      return (a.workflow?.sortRank??50)-(b.workflow?.sortRank??50);
    });
    return result;
  },[data]);

  const selectedDate=days.find((day)=>dayKey(day)===selected)??days[0];
  const selectedOrders=byDay.get(selected)??[];
  const backlog=(data?.orders??[]).filter((order)=>!order.estimatedCompletionAt);
  const waitingParts=(data?.orders??[]).filter((order)=>order.status==='WAITING_PARTS');
  const ready=(data?.orders??[]).filter((order)=>['REPAIR_DONE','READY'].includes(order.status));

  const moveOrder=async(orderId:string,target:string|null,targetIndex=999)=>{
    if(moving)return;
    const current=data?.orders.find((item)=>item.id===orderId); if(!current)return;
    const oldDay=current.estimatedCompletionAt?dayKey(new Date(current.estimatedCompletionAt)):null;
    const dateChanged=oldDay!==target;
    let effectiveIndex=targetIndex;
    if(target&&oldDay===target){
      const sourceIndex=(byDay.get(target)??[]).findIndex((item)=>item.id===orderId);
      if(sourceIndex>=0&&sourceIndex<effectiveIndex)effectiveIndex-=1;
    }
    setMoving(orderId);setError('');setNotice('');
    try{
      const result=await window.lockOn.service.updatePlan(orderId,{
        estimatedCompletionAt:target?apiDate(target):null,
        targetIndex:Math.max(0,effectiveIndex)
      });
      const refreshed=await window.lockOn.service.getTechnicianWorkspace();
      setData(refreshed);
      if(target)setSelected(target);
      const moved=result.order??current;
      const dateLabel=target?new Date(target+'T12:00:00').toLocaleDateString('pl-PL',{weekday:'long',day:'2-digit',month:'long'}):'Bez terminu';
      if(dateChanged){
        const delivery=result.notification;
        const mailSuffix=delivery?.sent
          ? ' Klient dostał e-mail o nowym terminie.'
          : delivery?.queued
            ? ' Wiadomość do klienta została dodana do kolejki.'
            : delivery?.reason==='NO_CUSTOMER_EMAIL'
              ? ' Klient nie ma adresu e-mail.'
              : delivery?.reason==='CUSTOMER_PREF_DISABLED'
                ? ' Klient ma wyłączone aktualizacje e-mail.'
                : '';
        setNotice(`#${moved.orderNumber} przeniesiono: ${dateLabel}.${mailSuffix}`);
      }else{
        setNotice(`Kolejność na ${dateLabel} została zapisana.`);
      }
    }catch(reason){setError(reason instanceof Error?reason.message:'Nie udało się zmienić planu pracy.');}
    finally{setMoving('');setDragging('');setDropTarget('');setDropIndex(null);}
  };

  const dropHandlers=(target:string|null)=>({
    onDragOver:(event:DragEvent)=>{event.preventDefault();if(dragging){setDropTarget(target??'NO_DATE');setDropIndex(null);}},
    onDragLeave:()=>{if(dropTarget===(target??'NO_DATE')&&dropIndex===null)setDropTarget('');},
    onDrop:(event:DragEvent)=>{
      event.preventDefault();
      const id=event.dataTransfer.getData('text/service-order')||dragging;
      const endIndex=target?(byDay.get(target)??[]).filter((order)=>order.id!==id).length:0;
      void moveOrder(id,target,endIndex);
    }
  });
  const orderDropHandlers=(index:number)=>({
    onDragOver:(event:DragEvent)=>{event.preventDefault();event.stopPropagation();if(dragging){setDropTarget(selected);setDropIndex(index);}},
    onDrop:(event:DragEvent)=>{event.preventDefault();event.stopPropagation();const id=event.dataTransfer.getData('text/service-order')||dragging;void moveOrder(id,selected,index);}
  });
  const dragProps=(order:ServiceOrderSummary)=>({
    draggable:!moving,
    onDragStart:(event:DragEvent)=>{event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/service-order',order.id);setDragging(order.id);},
    onDragEnd:()=>{setDragging('');setDropTarget('');setDropIndex(null);}
  });

  const shiftWeek=(offset:number)=>setWeekStart((current)=>{const next=new Date(current);next.setDate(next.getDate()+offset);return next;});
  const todayKey=dayKey(new Date());
  const weekLabel=`${days[0].toLocaleDateString('pl-PL',{day:'2-digit',month:'short'})} – ${days[6].toLocaleDateString('pl-PL',{day:'2-digit',month:'short',year:'numeric'})}`;

  return <section className="workplan-shell">
    <header className="workplan-head">
      <div>
        <span className="eyebrow"><CalendarDays size={13}/> PLAN PRACY</span>
        <h2>Twój tydzień — dokładnie w Twojej kolejności.</h2>
        <p>Przeciągaj telefon między dniami, a w obrębie dnia złap za uchwyt i ułóż: co robisz pierwsze, drugie i następne. Zmiana dnia automatycznie aktualizuje termin i wysyła klientowi e-mail.</p>
      </div>
      <div className="workplan-head-actions">
        <button className="button small secondary" onClick={()=>shiftWeek(-7)} title="Poprzedni tydzień"><ChevronLeft size={15}/></button>
        <button className="workplan-week-label" onClick={()=>{setWeekStart(startOfWeek());setSelected(todayKey);}}>{weekLabel}<small>kliknij, aby wrócić do dzisiaj</small></button>
        <button className="button small secondary" onClick={()=>shiftWeek(7)} title="Następny tydzień"><ChevronRight size={15}/></button>
        <button className="button small secondary" disabled={busy} onClick={()=>void load()} title="Odśwież"><RefreshCw size={14} className={busy?'spin':''}/></button>
      </div>
    </header>

    {error&&<div className="service-inline-error">{error}</div>}
    {notice&&<div className="service-inline-success workplan-notice"><MailCheck size={15}/>{notice}</div>}

    <div className="workplan-kpis">
      <div><Smartphone size={16}/><span>Aktywne</span><strong>{data?.counts.active??0}</strong></div>
      <div><Wrench size={16}/><span>W naprawie</span><strong>{data?.counts.inRepair??0}</strong></div>
      <div><Clock3 size={16}/><span>Czeka na części</span><strong>{data?.counts.waitingParts??0}</strong></div>
      <div><PackageCheck size={16}/><span>Do odbioru</span><strong>{data?.counts.readyForPickup??0}</strong></div>
    </div>

    <div className="workplan-days">
      {days.map((day)=>{
        const key=dayKey(day), count=(byDay.get(key)??[]).length, isToday=key===todayKey, active=key===selected;
        return <button key={key} className={(active?'active ':'')+(isToday?'today ':'')+(dropTarget===key&&dropIndex===null?'drop-target':'')} onClick={()=>setSelected(key)} {...dropHandlers(key)}>
          <span>{day.toLocaleDateString('pl-PL',{weekday:'short'})}</span>
          <strong>{day.toLocaleDateString('pl-PL',{day:'2-digit'})}</strong>
          <small>{count} {count===1?'zlecenie':'zleceń'}</small>
        </button>;
      })}
    </div>

    <div className="workplan-focus">
      <div className="workplan-focus-head">
        <div><span>WYBRANY DZIEŃ · PRZECIĄGNIJ, ABY UŁOŻYĆ KOLEJNOŚĆ</span><h3>{selectedDate.toLocaleDateString('pl-PL',{weekday:'long',day:'2-digit',month:'long'})}</h3></div>
        <b>{selectedOrders.length}</b>
      </div>
      <div className="workplan-list" {...dropHandlers(selected)}>
        {selectedOrders.map((order,index)=><div key={order.id} className={dropIndex===index&&dragging!==order.id?'workplan-drop-slot active':'workplan-drop-slot'} {...orderDropHandlers(index)}>
          <button className={'workplan-order '+statusTone(order)+(dragging===order.id?' dragging':'')} onClick={()=>onOpenOrder(order)} disabled={moving===order.id} {...dragProps(order)}>
            <GripVertical className="workplan-drag-handle" size={16}/>
            <span className="workplan-order-position">{index+1}</span>
            <span className="workplan-order-no">#{order.orderNumber}</span>
            <span className="workplan-order-copy"><strong>{device(order)}</strong><small>{order.customerName}</small></span>
            <span className="workplan-order-state"><strong>{order.workflow?.attentionLabel||order.statusLabel}</strong><small>{order.workflow?.nextAction||'Otwórz szczegóły'}</small></span>
          </button>
        </div>)}
        {dragging&&selectedOrders.length>0&&<div className={dropIndex===selectedOrders.length?'workplan-drop-end active':'workplan-drop-end'} onDragOver={(event)=>{event.preventDefault();event.stopPropagation();setDropTarget(selected);setDropIndex(selectedOrders.length);}} onDrop={(event)=>{event.preventDefault();event.stopPropagation();const id=event.dataTransfer.getData('text/service-order')||dragging;void moveOrder(id,selected,selectedOrders.length);}}>Upuść tutaj, aby zrobić na końcu</div>}
        {!selectedOrders.length&&<div className="workplan-empty"><CalendarDays size={25}/><strong>Ten dzień jest wolny</strong><span>Upuść tutaj zlecenie albo wybierz inny dzień.</span></div>}
      </div>
    </div>

    <div className="workplan-queues">
      <section><header><span>Czeka na części</span><b>{waitingParts.length}</b></header><div>{waitingParts.slice(0,5).map((order)=><button key={order.id} onClick={()=>onOpenOrder(order)}>#{order.orderNumber} · {device(order)}</button>)}{!waitingParts.length&&<small>Brak</small>}</div></section>
      <section><header><span>Gotowe do odbioru</span><b>{ready.length}</b></header><div>{ready.slice(0,5).map((order)=><button key={order.id} onClick={()=>onOpenOrder(order)}>#{order.orderNumber} · {device(order)}</button>)}{!ready.length&&<small>Brak</small>}</div></section>
      <section className={dropTarget==='NO_DATE'?'drop-target':''} {...dropHandlers(null)}><header><span>Bez terminu</span><b>{backlog.length}</b></header><div>{backlog.slice(0,5).map((order)=><button key={order.id} onClick={()=>onOpenOrder(order)} {...dragProps(order)}>#{order.orderNumber} · {device(order)}</button>)}{!backlog.length&&<small>{dropTarget==='NO_DATE'?'Upuść tutaj':'Brak'}</small>}</div></section>
    </div>
  </section>;
}
