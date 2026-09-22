import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Ban,
  BellRing,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Copy,
  KeyRound,
  Link2,
  LogOut,
  Mail,
  MapPin,
  MessageSquareText,
  Pencil,
  RefreshCw,
  Save,
  Search,
  Send,
  ShieldCheck,
  Smartphone,
  Unlink,
  Unlock,
  UserRound,
  UserRoundCheck,
  UsersRound,
  Wrench
} from 'lucide-react';
import { useAppDialog } from '../components/AppDialog';
import type {
  CustomerAccountOverview,
  CustomerAccountSummary,
  CustomerQuoteRequest,
  ServiceCustomerDetail,
  ServiceOrderSummary,
  ServiceStatusHistoryItem
} from '../types/electron';

type CustomerFilter = 'ALL'|'ACTIVE'|'GOOGLE'|'CODE'|'BLOCKED';
type DetailTab = 'OVERVIEW'|'ORDERS'|'QUOTES'|'ACCESS';

const fmt = (value?: string | null) => {
  if (!value) return '—';
  try { return new Date(value).toLocaleString('pl-PL', { dateStyle:'short', timeStyle:'short' }); }
  catch { return '—'; }
};

const fmtDate = (value?: string | null) => {
  if (!value) return '—';
  try { return new Date(value).toLocaleDateString('pl-PL', { day:'2-digit', month:'short', year:'numeric' }); }
  catch { return '—'; }
};

const money = (value?: number | null, currency='PLN') =>
  value == null ? '—' : new Intl.NumberFormat('pl-PL',{style:'currency',currency}).format(value);

const initials = (name:string) =>
  name.split(/\s+/).filter(Boolean).slice(0,2).map((part)=>part[0]).join('').toUpperCase() || 'K';

const quoteStatusLabel = (status:CustomerQuoteRequest['status']) => ({
  OPEN:'Nowe',
  QUOTED:'Wycena gotowa',
  CLOSED:'Zamknięte',
  CANCELLED:'Anulowane'
}[status]);

const orderTone = (order:ServiceOrderSummary) => {
  if (['COMPLETED'].includes(order.status)) return 'done';
  if (['CANCELLED','REJECTED'].includes(order.status)) return 'closed';
  if (order.workflow?.flags.includes('OVERDUE')) return 'danger';
  if (order.workflow?.flags.includes('ACTION_NOW')) return 'attention';
  if (order.workflow?.flags.includes('READY_FOR_PICKUP')) return 'ready';
  return 'active';
};

export function CustomerAccountsPage() {
  const {confirm,prompt}=useAppDialog();
  const [data,setData]=useState<CustomerAccountOverview | null>(null);
  const [query,setQuery]=useState('');
  const [filter,setFilter]=useState<CustomerFilter>('ALL');
  const [busy,setBusy]=useState('');
  const busyRef=useRef('');
  const listRequestRef=useRef(0);
  const detailRequestRef=useRef(0);
  const setBusySafe=(value:string)=>{busyRef.current=value;setBusy(value);};
  const [notice,setNotice]=useState<{tone:'ok'|'error';text:string}|null>(null);
  const [codes,setCodes]=useState<Record<string,string>>({});

  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [detail,setDetail]=useState<ServiceCustomerDetail|null>(null);
  const [quotes,setQuotes]=useState<CustomerQuoteRequest[]>([]);
  const [detailTab,setDetailTab]=useState<DetailTab>('OVERVIEW');
  const [expandedOrderId,setExpandedOrderId]=useState<string|null>(null);
  const [histories,setHistories]=useState<Record<string,ServiceStatusHistoryItem[]>>({});
  const [quoteReply,setQuoteReply]=useState<Record<string,string>>({});
  const [quoteAmount,setQuoteAmount]=useState<Record<string,string>>({});
  const [editProfile,setEditProfile]=useState(false);
  const [profile,setProfile]=useState({firstName:'',lastName:'',email:'',phone:''});

  const load=async(silent=false)=>{
    const requestId=++listRequestRef.current;
    if(!silent)setBusySafe('load');
    try{
      const result=await window.lockOn.customers.list(query);
      if(requestId!==listRequestRef.current)return;
      setData(result);
      if(!silent)setNotice(null);
    }catch(error){
      if(requestId===listRequestRef.current&&!silent)setNotice({tone:'error',text:error instanceof Error?error.message:'Nie udało się pobrać klientów.'});
    }finally{
      if(requestId===listRequestRef.current&&busyRef.current==='load')setBusySafe('');
    }
  };

  const selected=useMemo(
    ()=>data?.customers.find((customer)=>customer.id===selectedId)??null,
    [data,selectedId]
  );

  const customers=useMemo(()=>{
    const items=data?.customers??[];
    if(filter==='GOOGLE')return items.filter((item)=>item.googleLinked&&!item.blocked);
    if(filter==='CODE')return items.filter((item)=>!item.googleLinked&&!item.blocked);
    if(filter==='BLOCKED')return items.filter((item)=>item.blocked);
    if(filter==='ACTIVE')return items.filter((item)=>item.activeSessions>0&&!item.blocked);
    return items;
  },[data,filter]);

  const filters=useMemo(()=>[
    {id:'ALL' as const,label:'Wszyscy',count:data?.stats.customers??0},
    {id:'ACTIVE' as const,label:'Aktywni teraz',count:(data?.customers??[]).filter((x)=>x.activeSessions>0&&!x.blocked).length},
    {id:'GOOGLE' as const,label:'Konto Google',count:data?.stats.googleAccounts??0},
    {id:'CODE' as const,label:'Tylko kod',count:(data?.customers??[]).filter((x)=>!x.googleLinked&&!x.blocked).length},
    {id:'BLOCKED' as const,label:'Zablokowani',count:data?.stats.blocked??0}
  ],[data]);

  useEffect(()=>{void load();},[]);
  useEffect(()=>{
    const timer=window.setTimeout(()=>void load(true),280);
    return()=>window.clearTimeout(timer);
  },[query]);
  useEffect(()=>{
    const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void load(true);},15000);
    return()=>window.clearInterval(timer);
  },[query]);

  const openCustomer=async(customer:CustomerAccountSummary)=>{
    const requestId=++detailRequestRef.current;
    setSelectedId(customer.id);
    setDetail(null);
    setQuotes([]);
    setDetailTab('OVERVIEW');
    setExpandedOrderId(null);
    setEditProfile(false);
    setBusySafe(customer.id+':open');
    setNotice(null);
    try{
      const [card,allQuotes]=await Promise.all([
        window.lockOn.service.getCustomer(customer.id),
        window.lockOn.service.listCustomerQuotes()
      ]);
      if(requestId!==detailRequestRef.current)return;
      setDetail(card);
      setQuotes(allQuotes.filter((item)=>item.customerId===customer.id));
      setProfile({
        firstName:card.customer.firstName||'',
        lastName:card.customer.lastName||'',
        email:card.customer.email||'',
        phone:card.customer.phone||''
      });
    }catch(error){
      if(requestId!==detailRequestRef.current)return;
      setNotice({tone:'error',text:error instanceof Error?error.message:'Nie udało się otworzyć klienta.'});
      setSelectedId(null);
    }finally{
      if(requestId===detailRequestRef.current&&busyRef.current===customer.id+':open')setBusySafe('');
    }
  };

  const refreshDetail=async()=>{
    if(busyRef.current||!selectedId)return;
    const customer=data?.customers.find((item)=>item.id===selectedId);
    if(!customer)return;
    await Promise.all([load(true),openCustomer(customer)]);
  };

  const getCode=async(customer:CustomerAccountSummary,rotate=false)=>{
    if(busyRef.current)return;
    if(rotate&&!await confirm({
      title:'Wygenerować nowy kod klienta?',
      message:customer.name,
      detail:'Stary kod oraz aktywne sesje utworzone tym kodem przestaną działać.',
      confirmLabel:'Wygeneruj nowy kod',tone:'warning'
    }))return;
    setBusySafe(customer.id+':code');setNotice(null);
    try{
      const result=await window.lockOn.customers.getCode(customer.id,rotate);
      setCodes(current=>({...current,[customer.id]:result.code}));
      setNotice({tone:'ok',text:rotate?'Nowy kod klienta jest gotowy.':'Kod klienta jest gotowy.'});
      await load(true);
    }catch(error){setNotice({tone:'error',text:error instanceof Error?error.message:'Nie udało się pobrać kodu.'});}
    finally{setBusySafe('');}
  };

  const sendCode=async(customer:CustomerAccountSummary)=>{
    if(busyRef.current)return;
    if(!customer.email){setNotice({tone:'error',text:'Ten klient nie ma zapisanego adresu e-mail.'});return;}
    setBusySafe(customer.id+':mail');setNotice(null);
    try{
      const result=await window.lockOn.customers.sendCode(customer.id);
      setNotice({tone:'ok',text:`Kod i link do portalu wysłano na ${result.recipient}.`});
    }catch(error){setNotice({tone:'error',text:error instanceof Error?error.message:'Nie udało się wysłać kodu.'});}
    finally{setBusySafe('');}
  };

  const toggleBlock=async(customer:CustomerAccountSummary)=>{
    if(busyRef.current)return;
    const next=!customer.blocked;
    if(!await confirm({
      title:next?'Zablokować portal klienta?':'Odblokować portal klienta?',
      message:customer.name,
      detail:next?'Wszystkie aktywne sesje klienta zostaną natychmiast zamknięte.':'Klient ponownie będzie mógł zalogować się do swojego portalu.',
      confirmLabel:next?'Zablokuj portal':'Odblokuj portal',
      tone:next?'danger':'default'
    }))return;
    const promptedReason=next ? await prompt({
      title:'Powód blokady',
      message:'Możesz zapisać krótką informację administracyjną.',
      inputLabel:'Powód (opcjonalnie)',
      placeholder:'Np. zgłoszenie klienta, bezpieczeństwo…',
      confirmLabel:'Zapisz i blokuj',
      tone:'warning'
    }) : '';
    if(next&&promptedReason===null)return;
    const reason=promptedReason||'';
    setBusySafe(customer.id+':block');setNotice(null);
    try{
      await window.lockOn.customers.block(customer.id,next,reason);
      setNotice({tone:'ok',text:next?'Portal klienta został zablokowany.':'Portal klienta został odblokowany.'});
      await load(true);
    }catch(error){setNotice({tone:'error',text:error instanceof Error?error.message:'Nie udało się zmienić blokady.'});}
    finally{setBusySafe('');}
  };

  const logoutAll=async(customer:CustomerAccountSummary)=>{
    if(busyRef.current)return;
    if(!await confirm({
      title:'Wylogować klienta ze wszystkich sesji?',
      message:customer.name,
      detail:'Wszystkie aktywne sesje portalu klienta zostaną zamknięte. Kod i konto nie zostaną usunięte.',
      confirmLabel:'Wyloguj wszędzie',tone:'warning'
    }))return;
    setBusySafe(customer.id+':logout');setNotice(null);
    try{
      const result=await window.lockOn.customers.logoutAll(customer.id);
      setNotice({tone:'ok',text:`Zamknięto sesje: ${result.revoked}.`});
      await load(true);
    }catch(error){setNotice({tone:'error',text:error instanceof Error?error.message:'Nie udało się zakończyć sesji.'});}
    finally{setBusySafe('');}
  };

  const unlinkGoogle=async(customer:CustomerAccountSummary)=>{
    if(busyRef.current)return;
    if(!customer.googleLinked)return;
    if(!await confirm({
      title:'Odłączyć konto Google klienta?',
      message:customer.name,
      detail:'Klient nadal będzie mógł wejść kodem i później ponownie połączyć konto Google.',
      confirmLabel:'Odłącz Google',tone:'warning'
    }))return;
    setBusySafe(customer.id+':unlink');setNotice(null);
    try{
      const result=await window.lockOn.customers.unlinkGoogle(customer.id);
      setNotice({tone:'ok',text:`Konto Google odłączone. Zamknięte sesje Google: ${result.revoked}.`});
      await load(true);
      if(selectedId===customer.id)await refreshDetail();
    }catch(error){setNotice({tone:'error',text:error instanceof Error?error.message:'Nie udało się odłączyć Google.'});}
    finally{setBusySafe('');}
  };

  const saveProfile=async()=>{
    if(busyRef.current||!selectedId||!selected)return;
    if(!profile.firstName.trim()){setNotice({tone:'error',text:'Podaj imię klienta.'});return;}
    const emailChanged=(detail?.customer.email||'').trim().toLowerCase()!==profile.email.trim().toLowerCase();
    if(emailChanged&&selected.googleLinked&&!await confirm({
      title:'Zmienić e-mail klienta?',
      message:'Dla bezpieczeństwa obecne połączenie konta Google zostanie odłączone.',
      detail:'Klient będzie mógł ponownie połączyć Google po zapisaniu nowego adresu.',
      confirmLabel:'Zmień e-mail',tone:'warning'
    }))return;
    setBusySafe(selectedId+':profile');setNotice(null);
    try{
      const result=await window.lockOn.customers.updateProfile(selectedId,{
        firstName:profile.firstName.trim(),
        lastName:profile.lastName.trim(),
        email:profile.email.trim(),
        phone:profile.phone.trim()
      });
      setDetail((current)=>current?{...current,customer:{...current.customer,...result.customer}}:current);
      setEditProfile(false);
      setNotice({tone:'ok',text:result.googleDisconnected?'Dane zapisane. Poprzednie konto Google zostało bezpiecznie odłączone.':'Dane klienta zapisane.'});
      await load(true);
    }catch(error){setNotice({tone:'error',text:error instanceof Error?error.message:'Nie udało się zapisać danych klienta.'});}
    finally{setBusySafe('');}
  };

  const copyCode=async(customerId:string)=>{
    const code=codes[customerId];if(!code)return;
    try{await navigator.clipboard.writeText(code);setNotice({tone:'ok',text:'Kod skopiowany do schowka.'});}
    catch{setNotice({tone:'error',text:'Nie udało się skopiować kodu.'});}
  };

  const toggleHistory=async(order:ServiceOrderSummary)=>{
    if(busyRef.current)return;
    if(expandedOrderId===order.id){setExpandedOrderId(null);return;}
    setExpandedOrderId(order.id);
    if(histories[order.id])return;
    setBusySafe(order.id+':history');
    try{
      const history=await window.lockOn.service.getHistory(order.id);
      setHistories((current)=>({...current,[order.id]:history}));
    }catch(error){setNotice({tone:'error',text:error instanceof Error?error.message:'Nie udało się pobrać historii zlecenia.'});}
    finally{setBusySafe('');}
  };

  const replyQuote=async(item:CustomerQuoteRequest)=>{
    if(busyRef.current)return;
    const message=(quoteReply[item.id]||'').trim();
    if(!message)return;
    setBusySafe(item.id+':reply');setNotice(null);
    try{
      await window.lockOn.service.replyCustomerQuote(item.id,message);
      setQuoteReply((current)=>({...current,[item.id]:''}));
      setNotice({tone:'ok',text:'Wiadomość wysłana do klienta.'});
      if(selected)await openCustomer(selected);
    }catch(error){setNotice({tone:'error',text:error instanceof Error?error.message:'Nie udało się wysłać wiadomości.'});}
    finally{setBusySafe('');}
  };

  const priceQuote=async(item:CustomerQuoteRequest)=>{
    if(busyRef.current)return;
    const amount=Number(String(quoteAmount[item.id]||'').replace(',','.'));
    if(!Number.isFinite(amount)||amount<0){setNotice({tone:'error',text:'Podaj prawidłową kwotę wyceny.'});return;}
    setBusySafe(item.id+':price');setNotice(null);
    try{
      await window.lockOn.service.priceCustomerQuote(item.id,amount);
      setQuoteAmount((current)=>({...current,[item.id]:''}));
      setNotice({tone:'ok',text:'Wycena zapisana i przekazana klientowi.'});
      if(selected)await openCustomer(selected);
    }catch(error){setNotice({tone:'error',text:error instanceof Error?error.message:'Nie udało się zapisać wyceny.'});}
    finally{setBusySafe('');}
  };

  const stats=data?.stats;

  if(selectedId&&selected){
    const orders=detail?.orders??[];
    const openOrders=orders.filter((order)=>!['COMPLETED','CANCELLED','REJECTED'].includes(order.status));
    const prefs=selected.notificationPreferences;
    return <div className="customer-accounts-page customer-control-center page-enter">
      <section className="customer-detail-heading">
        <button className="customer-back-button" disabled={Boolean(busy)} onClick={()=>{if(busyRef.current)return;detailRequestRef.current+=1;setBusySafe('');setSelectedId(null);setDetail(null);setQuotes([]);}}><ArrowLeft size={16}/> Klienci</button>
        <div className="customer-detail-title">
          <div className="customer-detail-avatar">{selected.googlePicture?<img src={selected.googlePicture} alt="" referrerPolicy="no-referrer"/>:initials(selected.name)}</div>
          <div>
            <span className="eyebrow">KARTA KLIENTA</span>
            <h1>{selected.name}</h1>
            <p>{selected.email||'Brak e-mailu'}{selected.phone?' · '+selected.phone:''}</p>
          </div>
        </div>
        <div className="customer-detail-badges">
          <span className={'account-chip '+(selected.googleLinked?'linked':'code')}>{selected.googleLinked?<><CheckCircle2 size={13}/> Konto Google</>:<><KeyRound size={13}/> Dostęp kodem</>}</span>
          {selected.blocked&&<span className="account-chip blocked"><Ban size={13}/> Portal zablokowany</span>}
        </div>
      </section>

      {notice&&<div className={'customer-notice '+notice.tone}>{notice.tone==='ok'?<CheckCircle2 size={16}/>:<Ban size={16}/>}<span>{notice.text}</span></div>}

      <section className="customer-detail-kpis">
        <article><Wrench size={18}/><div><span>Wszystkie naprawy</span><strong>{orders.length}</strong><small>{openOrders.length} aktywnych</small></div></article>
        <article><MessageSquareText size={18}/><div><span>Wyceny i rozmowy</span><strong>{quotes.length}</strong><small>{quotes.filter((q)=>['OPEN','QUOTED'].includes(q.status)).length} otwartych</small></div></article>
        <article><UserRoundCheck size={18}/><div><span>Sesje portalu</span><strong>{selected.activeSessions}</strong><small>ostatnio {fmt(selected.lastSeenAt||selected.lastLoginAt)}</small></div></article>
        <article><ShieldCheck size={18}/><div><span>Dostęp</span><strong>{selected.blocked?'Zablokowany':selected.googleLinked?'Google + kod':'Kod'}</strong><small>{selected.googleLinked?'pełne konto klienta':'tryb podglądu'}</small></div></article>
      </section>

      <nav className="service-tabs customer-detail-tabs">
        <button className={detailTab==='OVERVIEW'?'active':''} onClick={()=>setDetailTab('OVERVIEW')}><UserRound size={15}/> Klient</button>
        <button className={detailTab==='ORDERS'?'active':''} onClick={()=>setDetailTab('ORDERS')}><Smartphone size={15}/> Zlecenia <b>{orders.length}</b></button>
        <button className={detailTab==='QUOTES'?'active':''} onClick={()=>setDetailTab('QUOTES')}><MessageSquareText size={15}/> Wyceny <b>{quotes.length}</b></button>
        <button className={detailTab==='ACCESS'?'active':''} onClick={()=>setDetailTab('ACCESS')}><KeyRound size={15}/> Dostęp</button>
      </nav>

      {busy.endsWith(':open')&&!detail&&<div className="panel-card customer-detail-loading"><span className="boot-spinner"/> Pobieram pełną kartę klienta…</div>}

      {detail&&detailTab==='OVERVIEW'&&<div className="customer-detail-grid">
        <section className="panel-card customer-profile-card">
          <div className="panel-heading customer-panel-heading">
            <div><span className="eyebrow">DANE KLIENTA</span><h2>Kontakt i profil</h2><p>Jedno źródło danych używane przez portal, e-maile i zlecenia.</p></div>
            {!editProfile&&<button className="button small secondary" onClick={()=>setEditProfile(true)}><Pencil size={14}/> Edytuj</button>}
          </div>
          {editProfile?<div className="customer-profile-form">
            <label><span>Imię</span><input value={profile.firstName} onChange={(e)=>setProfile({...profile,firstName:e.target.value})}/></label>
            <label><span>Nazwisko</span><input value={profile.lastName} onChange={(e)=>setProfile({...profile,lastName:e.target.value})}/></label>
            <label><span>E-mail</span><input type="email" value={profile.email} onChange={(e)=>setProfile({...profile,email:e.target.value})}/></label>
            <label><span>Telefon</span><input value={profile.phone} onChange={(e)=>setProfile({...profile,phone:e.target.value})}/></label>
            <div className="customer-profile-actions"><button className="button secondary" onClick={()=>setEditProfile(false)}>Anuluj</button><button className="button primary" disabled={busy===selectedId+':profile'} onClick={()=>void saveProfile()}><Save size={14}/> Zapisz dane</button></div>
          </div>:<div className="customer-profile-read">
            <div><span>Imię i nazwisko</span><strong>{detail.customer.firstName} {detail.customer.lastName}</strong></div>
            <div><span>E-mail</span><strong>{detail.customer.email||'Nie podano'}</strong></div>
            <div><span>Telefon</span><strong>{detail.customer.phone||'Nie podano'}</strong></div>
            <div><span>Klient od</span><strong>{fmtDate(detail.customer.createdAt)}</strong></div>
          </div>}
        </section>

        <section className="panel-card customer-activity-card">
          <div className="panel-heading customer-panel-heading"><div><span className="eyebrow">SERWIS</span><h2>Ostatnia aktywność</h2><p>Najważniejsze informacje bez wchodzenia w każde zlecenie.</p></div></div>
          {orders.slice(0,3).map((order)=><button key={order.id} className="customer-mini-order" onClick={()=>{setDetailTab('ORDERS');void toggleHistory(order);}}>
            <span className="customer-mini-number">#{order.orderNumber}</span>
            <div><strong>{order.brand} {order.model}</strong><small>{order.statusLabel} · {fmt(order.updatedAt||order.receivedAt)}</small></div>
            <span>{order.currentLocationLabel||order.currentPointName||order.homePointName||order.pointName}</span>
          </button>)}
          {!orders.length&&<div className="service-empty">Ten klient nie ma jeszcze zleceń w Twoim zakresie.</div>}
        </section>

        <section className="panel-card customer-device-card">
          <div className="panel-heading customer-panel-heading"><div><span className="eyebrow">URZĄDZENIA</span><h2>Historia urządzeń</h2><p>Sprzęt pojawiający się w naprawach tego klienta.</p></div></div>
          <div className="customer-device-list">
            {detail.devices.map((device)=><article key={device.id}><Smartphone size={17}/><div><strong>{device.brand} {device.model}</strong><span>{device.imei?'IMEI '+device.imei:'Bez IMEI'}{device.serialNumber?' · S/N '+device.serialNumber:''}</span></div></article>)}
            {!detail.devices.length&&<div className="service-empty">Brak urządzeń.</div>}
          </div>
        </section>

        <section className="panel-card customer-preferences-card">
          <div className="panel-heading customer-panel-heading"><div><span className="eyebrow">POWIADOMIENIA</span><h2>Wybory klienta</h2><p>Wsparcie widzi preferencje, ale ich nie nadpisuje za klienta.</p></div></div>
          <div className="customer-pref-list">
            <div className={prefs.serviceUpdates?'on':''}><BellRing size={15}/><span>Postęp naprawy</span><b>{prefs.serviceUpdates?'Włączone':'Wyłączone'}</b></div>
            <div className={prefs.readyForPickup?'on':''}><BellRing size={15}/><span>Gotowe do odbioru</span><b>{prefs.readyForPickup?'Włączone':'Wyłączone'}</b></div>
            <div className={prefs.quoteUpdates?'on':''}><BellRing size={15}/><span>Wyceny</span><b>{prefs.quoteUpdates?'Włączone':'Wyłączone'}</b></div>
            <div className={prefs.messages?'on':''}><BellRing size={15}/><span>Wiadomości</span><b>{prefs.messages?'Włączone':'Wyłączone'}</b></div>
          </div>
        </section>
      </div>}

      {detail&&detailTab==='ORDERS'&&<section className="panel-card customer-orders-workspace">
        <div className="panel-heading customer-panel-heading">
          <div><span className="eyebrow">NAPRAWY KLIENTA</span><h2>Zlecenia serwisowe</h2><p>Ta sama czytelna hierarchia co w module Serwis. Kliknij zlecenie, aby zobaczyć historię.</p></div>
          <button className="button small secondary" disabled={Boolean(busy)} onClick={()=>void refreshDetail()}><RefreshCw className={busy? 'spin':''} size={14}/> Odśwież</button>
        </div>
        <div className="customer-order-control-list">
          {orders.map((order)=><article key={order.id} className={'customer-control-order '+orderTone(order)+(expandedOrderId===order.id?' expanded':'')}>
            <button className="customer-control-order-head" onClick={()=>void toggleHistory(order)}>
              <div className="service-order-number"><strong>#{order.orderNumber}</strong><span>{fmtDate(order.receivedAt)}</span></div>
              <div className="customer-control-order-main">
                <strong>{order.brand} {order.model}</strong>
                <span>{order.issueDescription||'Brak opisu usterki'}</span>
                <div className="service-order-quick-meta">
                  <span><MapPin size={12}/>{order.currentLocationLabel||order.currentPointName||order.homePointName||order.pointName}</span>
                  <span><Clock3 size={12}/>{order.estimatedCompletionAt?'Termin '+fmtDate(order.estimatedCompletionAt):'Bez terminu'}</span>
                </div>
              </div>
              <div className="customer-control-order-stage">
                <span>{order.workflow?.stageLabel||order.statusLabel}</span>
                <strong>{order.workflow?.nextAction||order.statusLabel}</strong>
              </div>
              {expandedOrderId===order.id?<ChevronUp size={18}/>:<ChevronDown size={18}/>}
            </button>
            {expandedOrderId===order.id&&<div className="customer-control-order-detail">
              <div className="customer-order-detail-grid">
                <div><span>Status</span><strong>{order.statusLabel}</strong></div>
                <div><span>Punkt macierzysty</span><strong>{order.homePointName||order.pointName}</strong></div>
                <div><span>Aktualna lokalizacja</span><strong>{order.currentLocationLabel||order.currentPointName||'W drodze'}</strong></div>
                <div><span>Serwisant</span><strong>{order.assignedTechnicianName||'Nie przypisano'}</strong></div>
                <div><span>Cena orientacyjna</span><strong>{money(order.estimatedCost,order.currency)}</strong></div>
                <div><span>Cena końcowa</span><strong>{money(order.finalCost,order.currency)}</strong></div>
              </div>
              <div className="customer-history-strip">
                {(histories[order.id]||[]).map((item,index)=><div key={item.id} className="customer-history-event"><i className={index===(histories[order.id]?.length||0)-1?'current':''}/><div><strong>{item.toLabel}</strong><span>{fmt(item.changedAt)} · {item.changedByName}</span>{item.note&&<p>{item.note}</p>}</div></div>)}
                {busy===order.id+':history'&&<div className="service-history-empty">Pobieram historię…</div>}
                {busy!==order.id+':history'&&histories[order.id]?.length===0&&<div className="service-history-empty">Brak historii statusów.</div>}
              </div>
            </div>}
          </article>)}
          {!orders.length&&<div className="service-empty">Brak zleceń serwisowych dla tego klienta.</div>}
        </div>
      </section>}

      {detail&&detailTab==='QUOTES'&&<section className="panel-card customer-quotes-workspace">
        <div className="panel-heading customer-panel-heading"><div><span className="eyebrow">WYCENY I KONTAKT</span><h2>Rozmowy z klientem</h2><p>Wsparcie może obsłużyć rozmowę i przygotować wycenę w swoim zakresie.</p></div></div>
        <div className="customer-control-quotes">
          {quotes.map((item)=><article key={item.id} className={'customer-control-quote status-'+item.status.toLowerCase()}>
            <header><div><strong>{item.deviceDescription}</strong><span>{item.requestedPointName} → {item.routedPointName}</span></div><b>{quoteStatusLabel(item.status)}</b></header>
            <p>{item.issueDescription}</p>
            <div className="customer-quote-messages">
              {item.messages.map((message)=><div key={message.id} className={'customer-quote-message '+message.senderKind.toLowerCase()}><strong>{message.senderKind==='CUSTOMER'?'Klient':message.senderName||'ServiceOS'}</strong><p>{message.body}</p><span>{fmt(message.createdAt)}</span></div>)}
            </div>
            {!['CLOSED','CANCELLED'].includes(item.status)&&<div className="customer-quote-tools">
              <div className="customer-quote-price"><input inputMode="decimal" placeholder={item.quoteAmount!=null?money(item.quoteAmount,item.currency):'Kwota PLN'} value={quoteAmount[item.id]??''} onChange={(e)=>setQuoteAmount((current)=>({...current,[item.id]:e.target.value}))}/><button className="button small secondary" disabled={busy===item.id+':price'} onClick={()=>void priceQuote(item)}>Zapisz wycenę</button></div>
              <div className="customer-quote-reply"><input maxLength={1000} placeholder="Napisz do klienta…" value={quoteReply[item.id]??''} onChange={(e)=>setQuoteReply((current)=>({...current,[item.id]:e.target.value}))} onKeyDown={(e)=>{if(e.key==='Enter'){e.preventDefault();void replyQuote(item);}}}/><button className="button small primary" disabled={busy===item.id+':reply'} onClick={()=>void replyQuote(item)}><Send size={13}/> Wyślij</button></div>
            </div>}
          </article>)}
          {!quotes.length&&<div className="service-empty">Brak wycen i rozmów dla tego klienta.</div>}
        </div>
      </section>}

      {detail&&detailTab==='ACCESS'&&<div className="customer-access-grid">
        <section className="panel-card customer-access-main">
          <div className="panel-heading customer-panel-heading"><div><span className="eyebrow">PORTAL KLIENTA</span><h2>Dostęp i bezpieczeństwo</h2><p>Kod służy do podglądu. Google daje pełne konto i możliwość pisania do serwisu.</p></div></div>
          <div className="customer-access-summary">
            <div className="customer-access-icon">{selected.googleLinked?<Link2 size={22}/>:<KeyRound size={22}/>}</div>
            <div><span>Aktualny tryb</span><strong>{selected.googleLinked?'Konto Google + kod awaryjny':'Tylko kod klienta'}</strong><small>{selected.googleLinked?selected.googleEmail||'Google połączone':'Klient nie połączył jeszcze Google.'}</small></div>
          </div>
          <div className="customer-code-box">
            <span>Kod klienta</span>
            {codes[selected.id]?<div><code>{codes[selected.id]}</code><button onClick={()=>void copyCode(selected.id)}><Copy size={15}/></button></div>:<button className="button secondary" onClick={()=>void getCode(selected)}>Pokaż kod</button>}
          </div>
          <div className="customer-access-actions">
            <button className="button secondary" disabled={!selected.email||Boolean(busy)} onClick={()=>void sendCode(selected)}><Mail size={14}/> Wyślij kod i link</button>
            <button className="button secondary" disabled={Boolean(busy)} onClick={()=>void getCode(selected,true)}><KeyRound size={14}/> Wygeneruj nowy kod</button>
            {selected.googleLinked&&<button className="button secondary" disabled={Boolean(busy)} onClick={()=>void unlinkGoogle(selected)}><Unlink size={14}/> Odłącz Google</button>}
            {selected.activeSessions>0&&<button className="button secondary" disabled={Boolean(busy)} onClick={()=>void logoutAll(selected)}><LogOut size={14}/> Wyloguj wszystkie sesje</button>}
            <button className={'button '+(selected.blocked?'secondary':'danger-soft')} disabled={Boolean(busy)} onClick={()=>void toggleBlock(selected)}>{selected.blocked?<><Unlock size={14}/> Odblokuj portal</>:<><Ban size={14}/> Zablokuj portal</>}</button>
          </div>
        </section>

        <section className="panel-card customer-access-help">
          <ShieldCheck size={22}/>
          <div><strong>Jak działa bezpieczeństwo?</strong><p>Wsparcie LockOn i Właściciel mogą zarządzać dostępem klienta. Zwykły kod nie pozwala pisać ani zmieniać ustawień. Połączenie Google jest możliwe tylko dla e-mailu zapisanego przy kliencie.</p></div>
          <div className="customer-access-rule"><span>Blokada</span><b>natychmiast zamyka sesje</b></div>
          <div className="customer-access-rule"><span>Nowy kod</span><b>unieważnia stare sesje kodowe</b></div>
          <div className="customer-access-rule"><span>Zmiana e-mailu</span><b>odłącza Google dla bezpieczeństwa</b></div>
        </section>
      </div>}
    </div>;
  }

  return <div className="customer-accounts-page customer-control-center page-enter">
    <section className="customer-accounts-heading customer-control-heading">
      <div>
        <div className="eyebrow">CENTRUM KLIENTA</div>
        <h1>Klienci i ich serwisy</h1>
        <p>Jedno miejsce do obsługi klienta: naprawy, wyceny, portal, kody, konto Google i bezpieczeństwo. Dostęp mają Właściciel oraz osoby z uprawnieniem Wsparcie LockOn; zakres jest pilnowany także przez backend.</p>
      </div>
      <button className="button secondary" onClick={()=>void load()} disabled={busy==='load'}><RefreshCw size={16} className={busy==='load'?'spin':''}/> Odśwież</button>
    </section>

    {notice&&<div className={'customer-notice '+notice.tone}>{notice.tone==='ok'?<CheckCircle2 size={16}/>:<Ban size={16}/>}<span>{notice.text}</span></div>}

    <section className="customer-account-stats customer-control-stats">
      <article><UsersRound size={19}/><div><span>Klienci w zakresie</span><strong>{stats?.customers??0}</strong><small>powiązani z Twoimi punktami</small></div></article>
      <article><Link2 size={19}/><div><span>Konta Google</span><strong>{stats?.googleAccounts??0}</strong><small>pełny portal klienta</small></div></article>
      <article><UserRoundCheck size={19}/><div><span>Aktywne sesje</span><strong>{stats?.activeSessions??0}</strong><small>kod + Google</small></div></article>
      <article className={stats?.blocked?'attention':''}><Ban size={19}/><div><span>Zablokowane</span><strong>{stats?.blocked??0}</strong><small>dostęp wstrzymany</small></div></article>
    </section>

    <section className="panel-card customer-account-toolbar customer-control-toolbar">
      <div className="admin-search"><Search size={15}/><input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Szukaj po imieniu, e-mailu lub telefonie…"/></div>
      <small>{customers.length} klientów</small>
    </section>

    <div className="customer-filter-row">
      {filters.map((item)=><button key={item.id} className={filter===item.id?'active':''} onClick={()=>setFilter(item.id)}><span>{item.label}</span><b>{item.count}</b></button>)}
    </div>

    <section className="customer-account-list customer-control-list">
      {customers.map((customer)=><article className={'panel-card customer-control-row '+(customer.blocked?'blocked':'')} key={customer.id}>
        <button className="customer-control-open" onClick={()=>void openCustomer(customer)} disabled={Boolean(busy)}>
          <div className="customer-account-identity">
            {customer.googlePicture?<img src={customer.googlePicture} alt="" referrerPolicy="no-referrer"/>:<div>{initials(customer.name)}</div>}
            <span><strong>{customer.name}</strong><small>{customer.email||'Brak e-mailu'}{customer.phone?' · '+customer.phone:''}</small></span>
          </div>
          <div className="customer-control-status">
            <span className={'account-chip '+(customer.googleLinked?'linked':'code')}>{customer.googleLinked?<><CheckCircle2 size={13}/> Google</>:<><KeyRound size={13}/> Tylko kod</>}</span>
            {customer.blocked&&<span className="account-chip blocked"><Ban size={13}/> Zablokowany</span>}
            <small>Ostatnie wejście: {fmt(customer.lastSeenAt||customer.lastLoginAt)}</small>
          </div>
          <div className="customer-control-metrics">
            <div><span>Zlecenia</span><strong>{customer.orders}</strong></div>
            <div><span>Wyceny</span><strong>{customer.openQuotes}</strong></div>
            <div><span>Sesje</span><strong>{customer.activeSessions}</strong></div>
          </div>
          <div className="customer-control-next"><span>Otwórz klienta</span><ChevronDown size={18}/></div>
        </button>
        <div className="customer-control-quick-actions">
          <button disabled={Boolean(busy)||!customer.email} onClick={()=>void sendCode(customer)}><Mail size={14}/> Wyślij dostęp</button>
          <button disabled={Boolean(busy)} onClick={()=>void getCode(customer)}><KeyRound size={14}/> Kod</button>
          {customer.activeSessions>0&&<button disabled={Boolean(busy)} onClick={()=>void logoutAll(customer)}><LogOut size={14}/> Wyloguj</button>}
          <button className={customer.blocked?'':'danger'} disabled={Boolean(busy)} onClick={()=>void toggleBlock(customer)}>{customer.blocked?<><Unlock size={14}/> Odblokuj</>:<><ShieldCheck size={14}/> Zablokuj</>}</button>
        </div>
      </article>)}
      {!customers.length&&<div className="panel-card customer-account-empty">Nie znaleziono klientów pasujących do filtra.</div>}
    </section>
  </div>;
}
