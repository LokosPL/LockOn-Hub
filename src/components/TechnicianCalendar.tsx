import { useEffect, useMemo, useState, type DragEvent } from 'react';
import {
  CalendarDays, ChevronLeft, ChevronRight, Clock3, GripVertical, MailCheck, PackageCheck,
  RefreshCw, Smartphone, Wrench
} from 'lucide-react';
import type { ServiceOrderSummary, TechnicianWorkspace } from '../types/electron';
import './TechnicianCalendar.css';

interface Props { onOpenOrder:(order:ServiceOrderSummary)=>void; }

type CalendarTone = 'holiday' | 'trading' | 'off' | 'weekend';
type CalendarInfo = { label:string; tone:CalendarTone };

const pad=(value:number)=>String(value).padStart(2,'0');
const dayKey=(value:Date)=>`${value.getFullYear()}-${pad(value.getMonth()+1)}-${pad(value.getDate())}`;
const apiDate=(key:string)=>new Date(key+'T12:00:00').toISOString();
const startOfWeek=(source=new Date())=>{
  const date=new Date(source); date.setHours(0,0,0,0);
  date.setDate(date.getDate()-((date.getDay()+6)%7));
  return date;
};
const addDays=(source:Date,amount:number)=>{
  const date=new Date(source);
  date.setDate(date.getDate()+amount);
  return date;
};
const device=(order:ServiceOrderSummary)=>[order.brand,order.model].filter(Boolean).join(' ')||'Telefon';
const statusTone=(order:ServiceOrderSummary)=>{
  if(order.workflow?.flags.includes('OVERDUE'))return 'danger';
  if(order.workflow?.flags.includes('DUE_SOON'))return 'warning';
  if(order.workflow?.flags.includes('READY_FOR_PICKUP'))return 'ready';
  return 'default';
};

// Algorytm Meeusa/Jonesa/Butchera — wyłącznie do wyznaczenia polskich świąt ruchomych.
const easterSunday=(year:number)=>{
  const a=year%19;
  const b=Math.floor(year/100);
  const c=year%100;
  const d=Math.floor(b/4);
  const e=b%4;
  const f=Math.floor((b+8)/25);
  const g=Math.floor((b-f+1)/3);
  const h=(19*a+b-d-g+15)%30;
  const i=Math.floor(c/4);
  const k=c%4;
  const l=(32+2*e+2*i-h-k)%7;
  const m=Math.floor((a+11*h+22*l)/451);
  const month=Math.floor((h+l-7*m+114)/31);
  const day=((h+l-7*m+114)%31)+1;
  return new Date(year,month-1,day);
};

const polishHoliday=(date:Date):string|null=>{
  const year=date.getFullYear();
  const key=dayKey(date);
  const fixed:Record<string,string>={
    [`${year}-01-01`]:'Nowy Rok',
    [`${year}-01-06`]:'Trzech Króli',
    [`${year}-05-01`]:'Święto Pracy',
    [`${year}-05-03`]:'Święto Konstytucji 3 Maja',
    [`${year}-08-15`]:'Wniebowzięcie NMP',
    [`${year}-11-01`]:'Wszystkich Świętych',
    [`${year}-11-11`]:'Święto Niepodległości',
    [`${year}-12-24`]:'Wigilia',
    [`${year}-12-25`]:'Boże Narodzenie',
    [`${year}-12-26`]:'Drugi dzień Świąt'
  };
  if(fixed[key])return fixed[key];

  const easter=easterSunday(year);
  const movable=new Map<string,string>([
    [dayKey(easter),'Wielkanoc'],
    [dayKey(addDays(easter,1)),'Poniedziałek Wielkanocny'],
    [dayKey(addDays(easter,49)),'Zielone Świątki'],
    [dayKey(addDays(easter,60)),'Boże Ciało']
  ]);
  return movable.get(key)??null;
};

const lastSundayOfMonth=(year:number,month:number)=>{
  const date=new Date(year,month,0);
  date.setDate(date.getDate()-date.getDay());
  return dayKey(date);
};

const tradingSundaysForYear=(year:number)=>{
  const easter=easterSunday(year);
  const result=new Set<string>([
    lastSundayOfMonth(year,1),
    lastSundayOfMonth(year,4),
    lastSundayOfMonth(year,6),
    lastSundayOfMonth(year,8),
    dayKey(addDays(easter,-7))
  ]);

  // Obowiązują trzy kolejne niedziele poprzedzające Wigilię.
  const christmasEve=new Date(year,11,24);
  let cursor=addDays(christmasEve,-1);
  while(cursor.getDay()!==0)cursor=addDays(cursor,-1);
  for(let index=0;index<3;index+=1){
    result.add(dayKey(cursor));
    cursor=addDays(cursor,-7);
  }
  return result;
};

const calendarInfo=(date:Date):CalendarInfo|null=>{
  const holiday=polishHoliday(date);
  if(holiday)return {label:holiday,tone:'holiday'};
  if(date.getDay()===0){
    return tradingSundaysForYear(date.getFullYear()).has(dayKey(date))
      ? {label:'Niedziela handlowa',tone:'trading'}
      : {label:'Niedziela niehandlowa',tone:'off'};
  }
  if(date.getDay()===6)return {label:'Sobota',tone:'weekend'};
  return null;
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
  const selectedInfo=calendarInfo(selectedDate);
  const selectedOrders=byDay.get(selected)??[];
  const backlog=(data?.orders??[]).filter((order)=>!order.estimatedCompletionAt);
  const waitingParts=(data?.orders??[]).filter((order)=>order.status==='WAITING_PARTS');
  const ready=(data?.orders??[]).filter((order)=>['REPAIR_DONE','READY'].includes(order.status));
  const todayKey=dayKey(new Date());
  const draggedOrder=dragging?(data?.orders??[]).find((order)=>order.id===dragging):null;
  const canDropOn=(target:string|null,order=draggedOrder)=>{
    if(!order)return false;
    const source=order.estimatedCompletionAt?dayKey(new Date(order.estimatedCompletionAt)):null;
    if(source){
      if(!target)return false;
      return target>=source;
    }
    if(!target)return true;
    return target>=todayKey;
  };

  const moveOrder=async(orderId:string,target:string|null,targetIndex=999)=>{
    if(moving)return;
    const previous=data;
    const current=previous?.orders.find((item)=>item.id===orderId); if(!current)return;
    const oldDay=current.estimatedCompletionAt?dayKey(new Date(current.estimatedCompletionAt)):null;
    if(!canDropOn(target,current)){
      setError(oldDay
        ? 'Terminu nie można cofnąć ani usunąć. Możesz zmienić kolejność w tym samym dniu albo przesunąć zlecenie na później.'
        : 'Nowe zlecenie możesz zaplanować na dzisiaj albo na późniejszy dzień.');
      setDragging('');setDropTarget('');setDropIndex(null);
      return;
    }
    const dateChanged=oldDay!==target;
    let effectiveIndex=targetIndex;
    if(target&&oldDay===target){
      const sourceIndex=(byDay.get(target)??[]).findIndex((item)=>item.id===orderId);
      if(sourceIndex>=0&&sourceIndex<effectiveIndex)effectiveIndex-=1;
    }
    effectiveIndex=Math.max(0,effectiveIndex);
    const targetIso=target?apiDate(target):null;

    if(previous){
      const remaining=previous.orders.filter((item)=>item.id!==orderId);
      const updatedCurrent={...current,estimatedCompletionAt:targetIso};
      if(target){
        const peers=remaining
          .filter((item)=>item.estimatedCompletionAt&&dayKey(new Date(item.estimatedCompletionAt))===target)
          .sort((a,b)=>(Number(a.planPosition||0)||999999)-(Number(b.planPosition||0)||999999));
        peers.splice(Math.min(effectiveIndex,peers.length),0,updatedCurrent);
        const positions=new Map(peers.map((item,index)=>[item.id,(index+1)*10]));
        setData({...previous,orders:[...remaining.map((item)=>positions.has(item.id)?{...item,planPosition:positions.get(item.id)}:item),{...updatedCurrent,planPosition:positions.get(orderId)||10}]});
      }else{
        setData({...previous,orders:[...remaining,{...updatedCurrent,planPosition:0}]});
      }
    }

    setMoving(orderId);setError('');setNotice('');
    try{
      const result=await window.lockOn.service.updatePlan(orderId,{
        estimatedCompletionAt:targetIso,
        targetIndex:effectiveIndex
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
    }catch(reason){
      if(previous)setData(previous);
      setError(reason instanceof Error?reason.message:'Nie udało się zmienić planu pracy. Zmiana została cofnięta.');
    }
    finally{setMoving('');setDragging('');setDropTarget('');setDropIndex(null);}
  };

  const dropHandlers=(target:string|null)=>({
    onDragOver:(event:DragEvent)=>{
      if(!dragging||!canDropOn(target))return;
      event.preventDefault();setDropTarget(target??'NO_DATE');setDropIndex(null);
    },
    onDragLeave:()=>{if(dropTarget===(target??'NO_DATE')&&dropIndex===null)setDropTarget('');},
    onDrop:(event:DragEvent)=>{
      const id=event.dataTransfer.getData('text/service-order')||dragging;
      const order=(data?.orders??[]).find((item)=>item.id===id);
      if(!order||!canDropOn(target,order))return;
      event.preventDefault();
      const endIndex=target?(byDay.get(target)??[]).filter((item)=>item.id!==id).length:0;
      void moveOrder(id,target,endIndex);
    }
  });
  const orderDropHandlers=(index:number)=>({
    onDragOver:(event:DragEvent)=>{
      if(!dragging||!canDropOn(selected))return;
      event.preventDefault();event.stopPropagation();setDropTarget(selected);setDropIndex(index);
    },
    onDrop:(event:DragEvent)=>{
      const id=event.dataTransfer.getData('text/service-order')||dragging;
      const order=(data?.orders??[]).find((item)=>item.id===id);
      if(!order||!canDropOn(selected,order))return;
      event.preventDefault();event.stopPropagation();void moveOrder(id,selected,index);
    }
  });
  const dragProps=(order:ServiceOrderSummary)=>({
    draggable:!moving,
    onDragStart:(event:DragEvent)=>{event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/service-order',order.id);setDragging(order.id);},
    onDragEnd:()=>{setDragging('');setDropTarget('');setDropIndex(null);}
  });

  const shiftWeek=(offset:number)=>setWeekStart((current)=>{const next=new Date(current);next.setDate(next.getDate()+offset);return next;});
  const weekLabel=`${days[0].toLocaleDateString('pl-PL',{day:'2-digit',month:'short'})} – ${days[6].toLocaleDateString('pl-PL',{day:'2-digit',month:'short',year:'numeric'})}`;

  return <section className="workplan-shell">
    <header className="workplan-head">
      <div>
        <span className="eyebrow"><CalendarDays size={13}/> PLAN PRACY</span>
        <h2>Twój tydzień — z dniami wolnymi i niedzielami handlowymi.</h2>
        <p>Święta, dni ustawowo wolne i niedziele są oznaczone od razu. Kolejność zleceń nadal układasz przeciąganiem, bez zmiany dotychczasowego sposobu pracy.</p>
      </div>
      <div className="workplan-head-actions">
        <button className="button small secondary" onClick={()=>shiftWeek(-7)} title="Poprzedni tydzień"><ChevronLeft size={15}/></button>
        <button className="workplan-week-label" onClick={()=>{setWeekStart(startOfWeek());setSelected(todayKey);}}>{weekLabel}<small>kliknij, aby wrócić do dzisiaj</small></button>
        <button className="button small secondary" onClick={()=>shiftWeek(7)} title="Następny tydzień"><ChevronRight size={15}/></button>
        <button className="button small secondary" disabled={busy} onClick={()=>void load()} title="Odśwież"><RefreshCw size={14} className={busy?'spin':''}/></button>
      </div>
    </header>

    <div className="workplan-calendar-legend" aria-label="Legenda kalendarza">
      <span className="calendar-legend-holiday">Święto / dzień wolny</span>
      <span className="calendar-legend-trading">Niedziela handlowa</span>
      <span className="calendar-legend-off">Niedziela niehandlowa</span>
      <span className="calendar-legend-weekend">Sobota</span>
    </div>

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
        const blocked=Boolean(draggedOrder)&&!canDropOn(key,draggedOrder);
        const info=calendarInfo(day);
        return <button key={key} className={(active?'active ':'')+(isToday?'today ':'')+(info?`calendar-${info.tone} `:'')+(dropTarget===key&&dropIndex===null?'drop-target ':'')+(blocked?'drop-blocked':'')} onClick={()=>setSelected(key)} {...dropHandlers(key)}>
          <span>{day.toLocaleDateString('pl-PL',{weekday:'short'})}</span>
          <strong>{day.toLocaleDateString('pl-PL',{day:'2-digit'})}</strong>
          {info&&<em className="workplan-day-info">{info.label}</em>}
          <small>{count} {count===1?'zlecenie':'zleceń'}</small>
        </button>;
      })}
    </div>

    <div className="workplan-focus">
      <div className="workplan-focus-head">
        <div>
          <span>WYBRANY DZIEŃ · PRZECIĄGNIJ, ABY UŁOŻYĆ KOLEJNOŚĆ{selectedInfo?' · '+selectedInfo.label.toUpperCase():''}</span>
          <h3>{selectedDate.toLocaleDateString('pl-PL',{weekday:'long',day:'2-digit',month:'long'})}</h3>
        </div>
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
        {dragging&&selectedOrders.length>0&&<div className={dropIndex===selectedOrders.length?'workplan-drop-end active':'workplan-drop-end'} onDragOver={(event)=>{if(!canDropOn(selected))return;event.preventDefault();event.stopPropagation();setDropTarget(selected);setDropIndex(selectedOrders.length);}} onDrop={(event)=>{const id=event.dataTransfer.getData('text/service-order')||dragging;const order=(data?.orders??[]).find((item)=>item.id===id);if(!order||!canDropOn(selected,order))return;event.preventDefault();event.stopPropagation();void moveOrder(id,selected,selectedOrders.length);}}>Upuść tutaj, aby zrobić na końcu</div>}
        {!selectedOrders.length&&<div className="workplan-empty"><CalendarDays size={25}/><strong>{selectedInfo?.label||'Ten dzień jest wolny'}</strong><span>{selectedInfo?.tone==='holiday'||selectedInfo?.tone==='off'?'To dzień wolny — zlecenie możesz zaplanować świadomie mimo oznaczenia.':'Upuść tutaj zlecenie albo wybierz inny dzień.'}</span></div>}
      </div>
    </div>

    <div className="workplan-queues">
      <section><header><span>Czeka na części</span><b>{waitingParts.length}</b></header><div>{waitingParts.slice(0,5).map((order)=><button key={order.id} onClick={()=>onOpenOrder(order)}>#{order.orderNumber} · {device(order)}</button>)}{!waitingParts.length&&<small>Brak</small>}</div></section>
      <section><header><span>Gotowe do odbioru</span><b>{ready.length}</b></header><div>{ready.slice(0,5).map((order)=><button key={order.id} onClick={()=>onOpenOrder(order)}>#{order.orderNumber} · {device(order)}</button>)}{!ready.length&&<small>Brak</small>}</div></section>
      <section className={(dropTarget==='NO_DATE'?'drop-target ':'')+(draggedOrder&&!canDropOn(null,draggedOrder)?'drop-blocked':'')} {...dropHandlers(null)}><header><span>Bez terminu</span><b>{backlog.length}</b></header><div>{backlog.slice(0,5).map((order)=><button key={order.id} onClick={()=>onOpenOrder(order)} {...dragProps(order)}>#{order.orderNumber} · {device(order)}</button>)}{!backlog.length&&<small>{dropTarget==='NO_DATE'?'Upuść tutaj':'Brak'}</small>}</div></section>
    </div>
  </section>;
}
