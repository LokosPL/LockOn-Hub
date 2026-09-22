import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, GripVertical, PackageCheck, RefreshCw, Smartphone, Wrench } from 'lucide-react';
import type { ServiceOrderSummary, TechnicianWorkspace } from '../types/electron';

interface Props { onOpenOrder:(order:ServiceOrderSummary)=>void; }
const pad=(value:number)=>String(value).padStart(2,'0');
const dayKey=(value:Date)=>`${value.getFullYear()}-${pad(value.getMonth()+1)}-${pad(value.getDate())}`;
const apiDate=(key:string)=>new Date(key+'T12:00:00').toISOString();
const startOfWeek=(source=new Date())=>{const date=new Date(source);date.setHours(0,0,0,0);date.setDate(date.getDate()-((date.getDay()+6)%7));return date;};
const device=(order:ServiceOrderSummary)=>[order.brand,order.model].filter(Boolean).join(' ')||'Telefon';
const statusTone=(order:ServiceOrderSummary)=>order.workflow?.flags.includes('OVERDUE')?'danger':order.workflow?.flags.includes('DUE_SOON')?'warning':order.workflow?.flags.includes('READY_FOR_PICKUP')?'ready':'default';

export function TechnicianCalendar({onOpenOrder}:Props){
  const [data,setData]=useState<TechnicianWorkspace|null>(null);
  const [weekStart,setWeekStart]=useState(()=>startOfWeek());
  const [selected,setSelected]=useState(()=>dayKey(new Date()));
  const [busy,setBusy]=useState(false);
  const [moving,setMoving]=useState('');
  const [dragging,setDragging]=useState('');
  const [dropTarget,setDropTarget]=useState('');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');

  const load=async()=>{if(busy)return;setBusy(true);setError('');try{setData(await window.lockOn.service.getTechnicianWorkspace());}catch(reason){setError(reason instanceof Error?reason.message:'Nie udało się pobrać planu pracy.');}finally{setBusy(false);}};
  useEffect(()=>{void load();const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void load();},90_000);return()=>window.clearInterval(timer);},[]);

  const days=useMemo(()=>Array.from({length:7},(_,index)=>{const date=new Date(weekStart);date.setDate(date.getDate()+index);return date;}),[weekStart]);
  useEffect(()=>{const keys=days.map(dayKey);if(!keys.includes(selected))setSelected(keys[0]);},[days,selected]);

  const byDay=useMemo(()=>{
    const result=new Map<string,ServiceOrderSummary[]>();
    for(const order of data?.orders??[]){
      if(!order.estimatedCompletionAt)continue;
      const date=new Date(order.estimatedCompletionAt);if(Number.isNaN(date.getTime()))continue;
      const key=dayKey(date);const list=result.get(key)??[];list.push(order);result.set(key,list);
    }
    for(const list of result.values())list.sort((a,b)=>(a.workQueuePosition??1000)-(b.workQueuePosition??1000)||Number(a.orderNumber)-Number(b.orderNumber));
    return result;
  },[data]);
  const selectedDate=days.find((day)=>dayKey(day)===selected)??days[0];
  const selectedOrders=byDay.get(selected)??[];
  const backlog=(data?.orders??[]).filter((order)=>!order.estimatedCompletionAt);
  const waitingParts=(data?.orders??[]).filter((order)=>order.status==='WAITING_PARTS');
  const ready=(data?.orders??[]).filter((order)=>['REPAIR_DONE','READY'].includes(order.status));

  const moveOrder=async(orderId:string,target:string)=>{
    if(moving)return;
    const current=data?.orders.find((item)=>item.id===orderId);if(!current)return;
    const oldKey=current.estimatedCompletionAt?dayKey(new Date(current.estimatedCompletionAt)):'';
    if(oldKey&&target<oldKey){setError('Terminu nie można przesunąć wstecz. Możesz zostawić obecną datę albo wydłużyć termin.');setDragging('');setDropTarget('');return;}
    if(oldKey===target){setSelected(target);setDragging('');setDropTarget('');return;}
    setMoving(orderId);setError('');setNotice('');
    try{
      const result=await window.lockOn.service.updateSchedule(orderId,{estimatedCompletionAt:apiDate(target)});
      const updated=result.order;
      setData((state)=>state?{...state,orders:state.orders.map((item)=>item.id===orderId?{...item,...updated}:item)}:state);
      setSelected(target);
      setNotice(result.notification?.sent
        ? `#${updated.orderNumber} przeniesiono na ${new Date(target+'T12:00:00').toLocaleDateString('pl-PL')}. Klient dostał e-mail o zmianie terminu.`
        : `#${updated.orderNumber} przeniesiono na ${new Date(target+'T12:00:00').toLocaleDateString('pl-PL')}.`);
    }catch(reason){setError(reason instanceof Error?reason.message:'Nie udało się zmienić terminu.');}
    finally{setMoving('');setDragging('');setDropTarget('');}
  };

  const reorder=async(dragId:string,targetId:string)=>{
    if(!dragId||dragId===targetId||moving)return;
    const current=[...selectedOrders];
    const from=current.findIndex((item)=>item.id===dragId),to=current.findIndex((item)=>item.id===targetId);
    if(from<0||to<0)return;
    const [moved]=current.splice(from,1);current.splice(to,0,moved);
    setMoving(dragId);setError('');setNotice('');
    setData((state)=>state?{...state,orders:state.orders.map((item)=>{
      const index=current.findIndex((candidate)=>candidate.id===item.id);
      return index>=0?{...item,workQueuePosition:(index+1)*100}:item;
    })}:state);
    try{
      await window.lockOn.service.reorderTechnicianDay(selected,current.map((item)=>item.id));
      setNotice('Kolejność pracy na ten dzień została zapisana.');
    }catch(reason){setError(reason instanceof Error?reason.message:'Nie udało się zapisać kolejności.');await load();}
    finally{setMoving('');setDragging('');setDropTarget('');}
  };

  const dayDropHandlers=(target:string)=>({
    onDragOver:(event:DragEvent)=>{event.preventDefault();if(dragging)setDropTarget(target);},
    onDragLeave:()=>{if(dropTarget===target)setDropTarget('');},
    onDrop:(event:DragEvent)=>{event.preventDefault();const id=event.dataTransfer.getData('text/service-order')||dragging;void moveOrder(id,target);}
  });
  const dragProps=(order:ServiceOrderSummary)=>({
    draggable:!moving,
    onDragStart:(event:DragEvent)=>{event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/service-order',order.id);setDragging(order.id);},
    onDragEnd:()=>{setDragging('');setDropTarget('');}
  });
  const shiftWeek=(offset:number)=>setWeekStart((current)=>{const next=new Date(current);next.setDate(next.getDate()+offset);return next;});
  const todayKey=dayKey(new Date());
  const weekLabel=`${days[0].toLocaleDateString('pl-PL',{day:'2-digit',month:'short'})} – ${days[6].toLocaleDateString('pl-PL',{day:'2-digit',month:'short',year:'numeric'})}`;

  return <section className="workplan-shell">
    <header className="workplan-head">
      <div><span className="eyebrow"><CalendarDays size={13}/> PLAN PRACY</span><h2>Ułóż dzień dokładnie tak, jak chcesz.</h2><p>Przeciągnij zlecenie na późniejszy dzień albo złap je na liście, aby ustawić kolejność pracy. Zmiana daty automatycznie informuje klienta e-mailem.</p></div>
      <div className="workplan-head-actions"><button className="button small secondary" onClick={()=>shiftWeek(-7)}><ChevronLeft size={15}/></button><button className="workplan-week-label" onClick={()=>{setWeekStart(startOfWeek());setSelected(todayKey);}}>{weekLabel}<small>wróć do dzisiaj</small></button><button className="button small secondary" onClick={()=>shiftWeek(7)}><ChevronRight size={15}/></button><button className="button small secondary" disabled={busy} onClick={()=>void load()}><RefreshCw size={14} className={busy?'spin':''}/></button></div>
    </header>
    {error&&<div className="service-inline-error">{error}</div>}
    {notice&&<div className="service-inline-success">{notice}</div>}
    <div className="workplan-kpis"><div><Smartphone size={16}/><span>Aktywne</span><strong>{data?.counts.active??0}</strong></div><div><Wrench size={16}/><span>W naprawie</span><strong>{data?.counts.inRepair??0}</strong></div><div><Clock3 size={16}/><span>Czeka na części</span><strong>{data?.counts.waitingParts??0}</strong></div><div><PackageCheck size={16}/><span>Do odbioru</span><strong>{data?.counts.readyForPickup??0}</strong></div></div>
    <div className="workplan-days">{days.map((day)=>{
      const key=dayKey(day),count=(byDay.get(key)??[]).length,isToday=key===todayKey,active=key===selected;
      const backward=dragging?Boolean((data?.orders.find(o=>o.id===dragging)?.estimatedCompletionAt)&&key<dayKey(new Date(data!.orders.find(o=>o.id===dragging)!.estimatedCompletionAt!))):false;
      return <button key={key} disabled={backward} className={(active?'active ':'')+(isToday?'today ':'')+(dropTarget===key?'drop-target ':'')+(backward?'blocked':'')} onClick={()=>setSelected(key)} {...dayDropHandlers(key)}><span>{day.toLocaleDateString('pl-PL',{weekday:'short'})}</span><strong>{day.toLocaleDateString('pl-PL',{day:'2-digit'})}</strong><small>{backward?'nie można cofnąć':`${count} ${count===1?'zlecenie':'zleceń'}`}</small></button>;
    })}</div>
    <div className="workplan-focus">
      <div className="workplan-focus-head"><div><span>KOLEJNOŚĆ NA DZIEŃ</span><h3>{selectedDate.toLocaleDateString('pl-PL',{weekday:'long',day:'2-digit',month:'long'})}</h3></div><b>{selectedOrders.length}</b></div>
      <div className="workplan-list">
        {selectedOrders.map((order,index)=><button key={order.id} className={'workplan-order '+statusTone(order)+(dragging===order.id?' dragging':'')} onClick={()=>onOpenOrder(order)} disabled={moving===order.id} {...dragProps(order)}
          onDragOver={(event)=>{event.preventDefault();if(dragging)setDropTarget('ORDER:'+order.id);}}
          onDrop={(event)=>{event.preventDefault();const id=event.dataTransfer.getData('text/service-order')||dragging;const source=data?.orders.find((item)=>item.id===id);const sourceDay=source?.estimatedCompletionAt?dayKey(new Date(source.estimatedCompletionAt)):'';if(sourceDay===selected)void reorder(id,order.id);else void moveOrder(id,selected);}}>
          <GripVertical size={15}/><span className="workplan-order-position">{index+1}</span><span className="workplan-order-no">#{order.orderNumber}</span><span className="workplan-order-copy"><strong>{device(order)}</strong><small>{order.customerName}</small></span><span className="workplan-order-state"><strong>{order.workflow?.attentionLabel||order.statusLabel}</strong><small>{order.workflow?.nextAction||'Otwórz szczegóły'}</small></span>
        </button>)}
        {!selectedOrders.length&&<div className="workplan-empty" {...dayDropHandlers(selected)}><CalendarDays size={25}/><strong>Ten dzień jest wolny</strong><span>Możesz przenieść tutaj zlecenie z wcześniejszego dnia.</span></div>}
      </div>
    </div>
    <div className="workplan-queues">
      <section><header><span>Czeka na części</span><b>{waitingParts.length}</b></header><div>{waitingParts.slice(0,5).map((order)=><button key={order.id} onClick={()=>onOpenOrder(order)}>#{order.orderNumber} · {device(order)}</button>)}{!waitingParts.length&&<small>Brak</small>}</div></section>
      <section><header><span>Gotowe / po naprawie</span><b>{ready.length}</b></header><div>{ready.slice(0,5).map((order)=><button key={order.id} onClick={()=>onOpenOrder(order)}>#{order.orderNumber} · {device(order)}</button>)}{!ready.length&&<small>Brak</small>}</div></section>
      <section><header><span>Bez terminu</span><b>{backlog.length}</b></header><div>{backlog.slice(0,5).map((order)=><button key={order.id} onClick={()=>onOpenOrder(order)} {...dragProps(order)}>#{order.orderNumber} · {device(order)}</button>)}{!backlog.length&&<small>Brak</small>}</div></section>
    </div>
  </section>;
}
