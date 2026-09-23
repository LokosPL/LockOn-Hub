import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, CheckCircle2, Clock3, MapPin, Pencil, RefreshCw, Save, Search,
  Smartphone, Truck, UserRound, UsersRound, Wrench
} from 'lucide-react';
import type {
  ServiceCustomerDetail,
  ServiceCustomerDirectoryItem,
  ServiceCustomerDirectoryOverview,
  ServiceOrderSummary,
  ServiceTransfer
} from '../types/electron';

interface ServiceCustomersPageProps {
  onOpenOrder: (orderId:string) => void;
}

const formatDevice = (order:ServiceOrderSummary) => {
  const parts=[order.brand,order.model].filter((value)=>value&&value!=='Nie podano');
  return parts.length?parts.join(' '):'Telefon';
};

const elapsed = (value?:string|null,now=Date.now()) => {
  if(!value)return '';
  const time=new Date(value).getTime();
  if(!Number.isFinite(time))return '';
  const diff=Math.max(0,now-time);
  const minutes=Math.floor(diff/60000);
  if(minutes<1)return 'przed chwilą';
  if(minutes<60)return `${minutes} min temu`;
  const hours=Math.floor(minutes/60);
  if(hours<24)return `${hours} godz. temu`;
  const days=Math.floor(hours/24);
  if(days<14)return `${days} dni temu`;
  return new Date(value).toLocaleDateString('pl-PL');
};

const transferMoment = (transfer?:ServiceTransfer|null) => {
  if(!transfer)return null;
  if(transfer.status==='ACCEPTED')return transfer.acceptedAt||transfer.updatedAt;
  if(transfer.status==='DELIVERED')return transfer.deliveredAt||transfer.updatedAt;
  if(transfer.status==='IN_TRANSIT')return transfer.shippedAt||transfer.requestedAt;
  return transfer.updatedAt||transfer.requestedAt;
};

const transferSentence = (transfer:ServiceTransfer,now:number) => {
  const when=elapsed(transferMoment(transfer),now);
  if(transfer.kind==='RETURN_HOME'){
    if(transfer.status==='IN_TRANSIT')return `Telefon wraca do punktu · wysłano ${when}`;
    if(transfer.status==='DELIVERED')return `Telefon wrócił do punktu · dotarł ${when}`;
    if(transfer.status==='ACCEPTED')return `Telefon przyjęto po powrocie · ${when}`;
    if(transfer.status==='CANCELLED')return `Powrót telefonu został anulowany · ${when}`;
    if(transfer.status==='REJECTED')return `Punkt nie przyjął telefonu · ${when}`;
  }
  if(transfer.status==='IN_TRANSIT')return `Telefon wysłano do serwisu ${when}`;
  if(transfer.status==='DELIVERED')return `Telefon dotarł do serwisu ${when}`;
  if(transfer.status==='ACCEPTED')return `Serwis przyjął telefon ${when}`;
  if(transfer.status==='CANCELLED')return `Wysyłka została anulowana ${when}`;
  if(transfer.status==='REJECTED')return `Serwis nie przyjął telefonu ${when}`;
  return `Ostatnia zmiana ${when}`;
};

const plainState = (order:ServiceOrderSummary) => {
  if(order.status==='READY')return 'Telefon czeka na odbiór';
  if(order.status==='COMPLETED')return 'Telefon wydany klientowi';
  if(order.status==='CANCELLED')return 'Zlecenie anulowane';
  if(order.status==='REJECTED')return 'Zlecenie zamknięte';
  if(order.openTransfer?.kind==='RETURN_HOME')return 'Telefon wraca do punktu';
  if(order.openTransfer)return 'Telefon jest w drodze';
  if(order.status==='REPAIR_DONE'&&order.returnRequired)return 'Naprawa zakończona — telefon ma wrócić';
  if(order.status==='REPAIR_DONE')return 'Naprawa zakończona';
  if(order.status==='IN_REPAIR')return 'Telefon jest naprawiany';
  if(order.status==='WAITING_PARTS')return 'Serwis czeka na części';
  if(order.status==='DIAGNOSIS')return 'Serwis sprawdza telefon';
  return 'Telefon został przyjęty';
};

export function ServiceCustomersPage({onOpenOrder}:ServiceCustomersPageProps){
  const [data,setData]=useState<ServiceCustomerDirectoryOverview|null>(null);
  const [query,setQuery]=useState('');
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [detail,setDetail]=useState<ServiceCustomerDetail|null>(null);
  const [profile,setProfile]=useState({firstName:'',lastName:'',email:'',phone:''});
  const [editing,setEditing]=useState(false);
  const [busy,setBusy]=useState('');
  const [notice,setNotice]=useState<{tone:'ok'|'error';text:string}|null>(null);
  const [nowMs,setNowMs]=useState(()=>Date.now());
  const requestRef=useRef(0);

  const load=async(silent=false)=>{
    const requestId=++requestRef.current;
    if(!silent)setBusy('list');
    try{
      const next=await window.lockOn.service.listCustomers(query);
      if(requestId!==requestRef.current)return;
      setData(next);
      if(!silent)setNotice(null);
    }catch(error){
      if(requestId===requestRef.current)setNotice({tone:'error',text:error instanceof Error?error.message:'Nie udało się pobrać klientów.'});
    }finally{
      if(requestId===requestRef.current)setBusy((current)=>current==='list'?'':current);
    }
  };

  useEffect(()=>{void load();},[]);
  useEffect(()=>{
    const timer=window.setTimeout(()=>void load(true),260);
    return()=>window.clearTimeout(timer);
  },[query]);
  useEffect(()=>{
    const timer=window.setInterval(()=>setNowMs(Date.now()),60_000);
    return()=>window.clearInterval(timer);
  },[]);

  const selected=useMemo(
    ()=>data?.customers.find((item)=>item.id===selectedId)??null,
    [data,selectedId]
  );

  const openCustomer=async(customer:ServiceCustomerDirectoryItem)=>{
    setSelectedId(customer.id);
    setDetail(null);
    setEditing(false);
    setBusy(customer.id);
    setNotice(null);
    try{
      const card=await window.lockOn.service.getCustomer(customer.id);
      setDetail(card);
      setProfile({
        firstName:card.customer.firstName||'',
        lastName:card.customer.lastName||'',
        email:card.customer.email||'',
        phone:card.customer.phone||''
      });
    }catch(error){
      setNotice({tone:'error',text:error instanceof Error?error.message:'Nie udało się otworzyć klienta.'});
      setSelectedId(null);
    }finally{setBusy('');}
  };

  const saveProfile=async()=>{
    if(!selectedId||busy)return;
    if(!profile.firstName.trim()){
      setNotice({tone:'error',text:'Podaj imię klienta.'});
      return;
    }
    setBusy('save');
    setNotice(null);
    try{
      const result=await window.lockOn.service.updateCustomerProfile(selectedId,{
        firstName:profile.firstName.trim(),
        lastName:profile.lastName.trim(),
        email:profile.email.trim(),
        phone:profile.phone.trim()
      });
      setDetail((current)=>current?{...current,customer:{...current.customer,...result.customer}}:current);
      setEditing(false);
      setNotice({tone:'ok',text:result.googleDisconnected
        ? 'Dane zapisane. Klient będzie musiał ponownie połączyć konto Google z nowym adresem e-mail.'
        : 'Dane klienta zostały zapisane.'});
      await load(true);
    }catch(error){
      setNotice({tone:'error',text:error instanceof Error?error.message:'Nie udało się zapisać danych klienta.'});
    }finally{setBusy('');}
  };

  if(selectedId&&selected){
    const orders=[...(detail?.orders??[])].sort((a,b)=>new Date(b.receivedAt).getTime()-new Date(a.receivedAt).getTime());
    return <div className="frontdesk-customers-page page-enter">
      <section className="frontdesk-customer-head">
        <button className="button secondary small" onClick={()=>{setSelectedId(null);setDetail(null);setEditing(false);setNotice(null);}}><ArrowLeft size={14}/> Wróć do klientów</button>
        <div>
          <span className="eyebrow"><UserRound size={13}/> KLIENT</span>
          <h1>{selected.name}</h1>
          <p>Kontakt, telefony i wszystkie zlecenia widoczne w Twoich punktach.</p>
        </div>
      </section>

      {notice&&<div className={`frontdesk-customer-notice ${notice.tone}`}>{notice.tone==='ok'?<CheckCircle2 size={16}/>:<span>!</span>}<strong>{notice.text}</strong></div>}

      <section className="frontdesk-customer-profile">
        <div className="frontdesk-customer-section-title">
          <div><UserRound size={18}/><span><strong>Dane klienta</strong><small>Możesz poprawić dane podane przez klienta przy ladzie.</small></span></div>
          {!editing
            ? <button className="button secondary small" onClick={()=>setEditing(true)}><Pencil size={13}/> Popraw dane</button>
            : <div className="frontdesk-customer-edit-actions"><button className="button secondary small" disabled={Boolean(busy)} onClick={()=>{setEditing(false);setProfile({firstName:detail?.customer.firstName||'',lastName:detail?.customer.lastName||'',email:detail?.customer.email||'',phone:detail?.customer.phone||''});}}>Anuluj</button><button className="button primary small" disabled={Boolean(busy)} onClick={()=>void saveProfile()}><Save size={13}/>{busy==='save'?'Zapisuję…':'Zapisz'}</button></div>}
        </div>
        <div className="frontdesk-customer-fields">
          <label><span>Imię</span><input disabled={!editing} value={profile.firstName} onChange={(e)=>setProfile((current)=>({...current,firstName:e.target.value}))}/></label>
          <label><span>Nazwisko</span><input disabled={!editing} value={profile.lastName} onChange={(e)=>setProfile((current)=>({...current,lastName:e.target.value}))}/></label>
          <label><span>E-mail</span><input disabled={!editing} type="email" value={profile.email} onChange={(e)=>setProfile((current)=>({...current,email:e.target.value}))}/></label>
          <label><span>Telefon</span><input disabled={!editing} value={profile.phone} onChange={(e)=>setProfile((current)=>({...current,phone:e.target.value}))}/></label>
        </div>
      </section>

      <section className="frontdesk-customer-orders">
        <div className="frontdesk-customer-section-title">
          <div><Smartphone size={18}/><span><strong>Telefony i zlecenia</strong><small>Od razu widać gdzie jest telefon i ile czasu minęło od wysyłki.</small></span></div>
          <b>{orders.length}</b>
        </div>
        {busy===selected.id&&!detail&&<div className="service-empty">Pobieram kartę klienta…</div>}
        {orders.map((order)=>{
          const lastTransfer=order.transfers?.[0]||order.latestTransfer||null;
          return <article className="frontdesk-customer-order" key={order.id}>
            <div className="frontdesk-customer-order-number"><strong>#{order.orderNumber}</strong><small>{new Date(order.receivedAt).toLocaleDateString('pl-PL')}</small></div>
            <div className="frontdesk-customer-order-main">
              <strong>{formatDevice(order)}</strong>
              <span>{plainState(order)}</span>
              <div className="frontdesk-customer-order-meta">
                <small><MapPin size={12}/>{order.currentLocationLabel||order.currentPointName||order.pointName}</small>
                {lastTransfer?<small><Truck size={12}/>{transferSentence(lastTransfer,nowMs)}</small>:<small><Clock3 size={12}/>Przyjęto {elapsed(order.receivedAt,nowMs)}</small>}
              </div>
            </div>
            <button className="button secondary small" onClick={()=>onOpenOrder(order.id)}><Wrench size={13}/> Otwórz zlecenie</button>
          </article>;
        })}
        {detail&&orders.length===0&&<div className="service-empty">Ten klient nie ma zleceń widocznych w Twoich punktach.</div>}
      </section>
    </div>;
  }

  const customers=data?.customers??[];
  return <div className="frontdesk-customers-page page-enter">
    <section className="frontdesk-customers-heading">
      <div>
        <span className="eyebrow"><UsersRound size={13}/> KLIENCI</span>
        <h1>Moi klienci</h1>
        <p>Klienci obsługiwani przez Twoje punkty. Możesz sprawdzić ich telefony, zlecenia i poprawić dane kontaktowe.</p>
      </div>
      <button className="button secondary small" disabled={busy==='list'} onClick={()=>void load()}><RefreshCw className={busy==='list'?'spin':''} size={14}/> Odśwież</button>
    </section>

    {notice&&<div className={`frontdesk-customer-notice ${notice.tone}`}>{notice.tone==='ok'?<CheckCircle2 size={16}/>:<span>!</span>}<strong>{notice.text}</strong></div>}

    <section className="frontdesk-customers-summary">
      <article><UsersRound size={18}/><span><small>Klienci</small><strong>{data?.stats.customers??0}</strong></span></article>
      <article><Wrench size={18}/><span><small>Aktywne zlecenia</small><strong>{data?.stats.activeOrders??0}</strong></span></article>
    </section>

    <section className="frontdesk-customers-list-card">
      <label className="frontdesk-customers-search"><Search size={15}/><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Szukaj po nazwisku, telefonie lub e-mailu"/></label>
      <div className="frontdesk-customers-list">
        {customers.map((customer)=><button key={customer.id} onClick={()=>void openCustomer(customer)} disabled={Boolean(busy)&&busy!==customer.id}>
          <span className="frontdesk-customer-avatar"><UserRound size={17}/></span>
          <span className="frontdesk-customer-list-main">
            <strong>{customer.name}</strong>
            <small>{customer.phone||customer.email||'Brak danych kontaktowych'}</small>
          </span>
          <span className="frontdesk-customer-list-count"><strong>{customer.activeOrders}</strong><small>aktywnych</small></span>
          <span className="frontdesk-customer-list-last"><Clock3 size={12}/>{customer.lastOrderAt?elapsed(customer.lastOrderAt,nowMs):'brak zleceń'}</span>
        </button>)}
        {!busy&&data&&customers.length===0&&<div className="service-empty">Brak klientów pasujących do wyszukiwania.</div>}
        {busy==='list'&&!data&&<div className="service-empty">Pobieram klientów…</div>}
      </div>
    </section>
  </div>;
}
