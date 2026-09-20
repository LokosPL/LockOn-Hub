import { useEffect, useMemo, useState } from 'react';
import {
  Ban,
  CheckCircle2,
  Copy,
  KeyRound,
  Link2,
  LogOut,
  Mail,
  RefreshCw,
  Search,
  ShieldCheck,
  Unlock,
  UserRoundCheck,
  UsersRound
} from 'lucide-react';
import type { CustomerAccountOverview, CustomerAccountSummary } from '../types/electron';

function fmt(value?: string | null) {
  if (!value) return '—';
  try { return new Date(value).toLocaleString('pl-PL', { dateStyle:'short', timeStyle:'short' }); }
  catch { return '—'; }
}

export function CustomerAccountsPage() {
  const [data,setData]=useState<CustomerAccountOverview | null>(null);
  const [query,setQuery]=useState('');
  const [busy,setBusy]=useState('');
  const [notice,setNotice]=useState('');
  const [codes,setCodes]=useState<Record<string,string>>({});

  const load=async(silent=false)=>{
    if(!silent)setBusy('load');
    try{
      setData(await window.lockOn.customers.list(query));
      if(!silent)setNotice('');
    }catch(error){
      if(!silent)setNotice(error instanceof Error?error.message:'Nie udało się pobrać klientów.');
    }finally{if(!silent)setBusy('');}
  };

  useEffect(()=>{void load();},[]);
  useEffect(()=>{
    const timer=window.setTimeout(()=>void load(true),280);
    return()=>window.clearTimeout(timer);
  },[query]);
  useEffect(()=>{
    const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void load(true);},15000);
    return()=>window.clearInterval(timer);
  },[query]);

  const stats=data?.stats;
  const customers=useMemo(()=>data?.customers??[],[data]);

  const getCode=async(customer:CustomerAccountSummary,rotate=false)=>{
    if(rotate&&!window.confirm(`Wygenerować nowy kod dla ${customer.name}? Stary kod i wszystkie bieżące sesje portalu przestaną działać.`))return;
    setBusy(customer.id+':code');setNotice('');
    try{
      const result=await window.lockOn.customers.getCode(customer.id,rotate);
      setCodes(current=>({...current,[customer.id]:result.code}));
      setNotice(rotate?'Nowy kod został wygenerowany.':'Kod klienta jest gotowy.');
      await load(true);
    }catch(error){setNotice(error instanceof Error?error.message:'Nie udało się pobrać kodu.');}
    finally{setBusy('');}
  };

  const sendCode=async(customer:CustomerAccountSummary)=>{
    if(!customer.email){setNotice('Ten klient nie ma zapisanego adresu e-mail.');return;}
    setBusy(customer.id+':mail');setNotice('');
    try{
      const result=await window.lockOn.customers.sendCode(customer.id);
      setNotice(`Kod wysłano na ${result.recipient}.`);
    }catch(error){setNotice(error instanceof Error?error.message:'Nie udało się wysłać kodu.');}
    finally{setBusy('');}
  };

  const toggleBlock=async(customer:CustomerAccountSummary)=>{
    const next=!customer.blocked;
    const message=next
      ? `Zablokować portal klienta ${customer.name}? Wszystkie jego aktywne sesje zostaną natychmiast zamknięte.`
      : `Odblokować portal klienta ${customer.name}?`;
    if(!window.confirm(message))return;
    const reason=next ? (window.prompt('Powód blokady (opcjonalnie):','')||'') : '';
    setBusy(customer.id+':block');setNotice('');
    try{
      await window.lockOn.customers.block(customer.id,next,reason);
      setNotice(next?'Dostęp klienta został zablokowany.':'Dostęp klienta został odblokowany.');
      await load(true);
    }catch(error){setNotice(error instanceof Error?error.message:'Nie udało się zmienić blokady.');}
    finally{setBusy('');}
  };

  const logoutAll=async(customer:CustomerAccountSummary)=>{
    if(!window.confirm(`Wylogować ${customer.name} ze wszystkich aktywnych sesji portalu?`))return;
    setBusy(customer.id+':logout');setNotice('');
    try{
      const result=await window.lockOn.customers.logoutAll(customer.id);
      setNotice(`Zamknięto sesje: ${result.revoked}.`);
      await load(true);
    }catch(error){setNotice(error instanceof Error?error.message:'Nie udało się zakończyć sesji.');}
    finally{setBusy('');}
  };

  const copyCode=async(customerId:string)=>{
    const code=codes[customerId];if(!code)return;
    try{await navigator.clipboard.writeText(code);setNotice('Kod skopiowany do schowka.');}
    catch{setNotice('Nie udało się skopiować kodu.');}
  };

  return <div className="customer-accounts-page page-enter">
    <section className="customer-accounts-heading">
      <div>
        <div className="eyebrow">PORTALE KLIENTÓW</div>
        <h1>Konta klientów</h1>
        <p>Kody dostępu, konta Google, aktywne sesje i blokady w jednym miejscu. Wsparcie LockOn widzi klientów tylko w swoim zakresie.</p>
      </div>
      <button className="button secondary" onClick={()=>void load()} disabled={busy==='load'}><RefreshCw size={16} className={busy==='load'?'spin':''}/> Odśwież</button>
    </section>

    {notice&&<div className="admin-notice">{notice}</div>}

    <section className="customer-account-stats">
      <article><UsersRound size={19}/><div><span>Klienci w zakresie</span><strong>{stats?.customers??0}</strong></div></article>
      <article><Link2 size={19}/><div><span>Konta Google</span><strong>{stats?.googleAccounts??0}</strong></div></article>
      <article><UserRoundCheck size={19}/><div><span>Aktywne sesje</span><strong>{stats?.activeSessions??0}</strong></div></article>
      <article className={stats?.blocked?'attention':''}><Ban size={19}/><div><span>Zablokowane</span><strong>{stats?.blocked??0}</strong></div></article>
    </section>

    <section className="panel-card customer-account-toolbar">
      <div className="admin-search"><Search size={15}/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Szukaj klienta, e-mailu lub telefonu…"/></div>
      <small>{customers.length} wyników</small>
    </section>

    <section className="customer-account-list">
      {customers.map(customer=><article className={'panel-card customer-account-row '+(customer.blocked?'blocked':'')} key={customer.id}>
        <div className="customer-account-identity">
          {customer.googlePicture?<img src={customer.googlePicture} alt="" referrerPolicy="no-referrer"/>:<div>{customer.name.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase()||'K'}</div>}
          <span><strong>{customer.name}</strong><small>{customer.email||'Brak e-mailu'}{customer.phone?' · '+customer.phone:''}</small></span>
        </div>

        <div className="customer-account-state">
          <span className={'account-chip '+(customer.googleLinked?'linked':'code')}>
            {customer.googleLinked?<><CheckCircle2 size={13}/> Google połączone</>:<><KeyRound size={13}/> Tylko kod</>}
          </span>
          {customer.blocked&&<span className="account-chip blocked"><Ban size={13}/> Portal zablokowany</span>}
          <small>Ostatnie wejście: {fmt(customer.lastSeenAt||customer.lastLoginAt)}</small>
        </div>

        <div className="customer-account-metrics">
          <div><span>Zlecenia</span><strong>{customer.orders}</strong></div>
          <div><span>Otwarte wyceny</span><strong>{customer.openQuotes}</strong></div>
          <div><span>Sesje</span><strong>{customer.activeSessions}</strong></div>
        </div>

        <div className="customer-account-code">
          <span>Kod klienta</span>
          {codes[customer.id]
            ? <div><code>{codes[customer.id]}</code><button title="Kopiuj" onClick={()=>void copyCode(customer.id)}><Copy size={14}/></button></div>
            : <button className="text-action" onClick={()=>void getCode(customer)} disabled={Boolean(busy)}>Pokaż / wygeneruj kod</button>}
        </div>

        <div className="customer-account-actions">
          <button className="button small secondary" disabled={Boolean(busy)||!customer.email} onClick={()=>void sendCode(customer)}><Mail size={14}/> Wyślij kod</button>
          <button className="button small secondary" disabled={Boolean(busy)} onClick={()=>void getCode(customer,true)}><KeyRound size={14}/> Nowy kod</button>
          {customer.activeSessions>0&&<button className="button small secondary" disabled={Boolean(busy)} onClick={()=>void logoutAll(customer)}><LogOut size={14}/> Wyloguj sesje</button>}
          <button className={'button small '+(customer.blocked?'secondary':'danger-soft')} disabled={Boolean(busy)} onClick={()=>void toggleBlock(customer)}>
            {customer.blocked?<><Unlock size={14}/> Odblokuj</>:<><ShieldCheck size={14}/> Zablokuj portal</>}
          </button>
        </div>
      </article>)}
      {!customers.length&&<div className="panel-card customer-account-empty">Nie znaleziono klientów w Twoim zakresie.</div>}
    </section>
  </div>;
}
