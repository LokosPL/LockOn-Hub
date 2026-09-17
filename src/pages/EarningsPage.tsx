import { useEffect, useMemo, useState } from 'react';
import { BadgeDollarSign, CheckCircle2, Clock3, RefreshCw, Send, XCircle } from 'lucide-react';
import type { AuthState, FinancePayload, RevenueEntry } from '../types/electron';
import type { UserRole } from '../config/roles';

const money = (value:number) => new Intl.NumberFormat('pl-PL',{style:'currency',currency:'PLN'}).format(value || 0);
const today = new Date().toISOString().slice(0,10);

interface Props { auth: AuthState; effectiveRole: UserRole; }

export function EarningsPage({ auth, effectiveRole }: Props) {
  const actualRole = auth.role as UserRole;
  const [data,setData] = useState<FinancePayload | null>(null);
  const [amount,setAmount] = useState('');
  const [workDate,setWorkDate] = useState(today);
  const [pointId,setPointId] = useState(auth.point?.id ?? '');
  const [note,setNote] = useState('');
  const [busy,setBusy] = useState(false);
  const [notice,setNotice] = useState('');

  const load = async()=>{ setBusy(true); try{ setData(await window.lockOn.finance.list()); } catch(e){ setNotice(e instanceof Error?e.message:'Błąd rozliczeń.'); } finally{setBusy(false);} };
  useEffect(()=>{ void load(); },[]);

  const canSubmit = actualRole === 'TECHNICIAN' && effectiveRole === 'TECHNICIAN';
  const canReview = ['OWNER','BOSS'].includes(actualRole) && ['OWNER','BOSS'].includes(effectiveRole);
  const pending = useMemo(()=>data?.entries.filter(e=>e.status==='PENDING') ?? [],[data]);

  const submit = async()=>{
    const parsed = Number(amount.replace(',','.'));
    if(!Number.isFinite(parsed)||parsed<=0){setNotice('Wpisz prawidłową kwotę.');return;}
    if(!pointId){setNotice('Wybierz punkt.');return;}
    setBusy(true);setNotice('');
    try{await window.lockOn.finance.submit({amount:parsed,pointId,workDate,note});setAmount('');setNote('');setNotice('Przychód wysłany do weryfikacji. Podział po zatwierdzeniu: 50% Serwisant / 50% Szef.');await load();}
    catch(e){setNotice(e instanceof Error?e.message:'Nie udało się wysłać przychodu.');}finally{setBusy(false);}
  };

  const review = async(entry:RevenueEntry,action:'APPROVE'|'REJECT')=>{setBusy(true);setNotice('');try{await window.lockOn.finance.review(entry.id,action);setNotice(action==='APPROVE'?'Przychód zatwierdzony i podzielony 50/50.':'Przychód odrzucony.');await load();}catch(e){setNotice(e instanceof Error?e.message:'Błąd weryfikacji.');}finally{setBusy(false);}};

  return <div className="earnings-page page-enter">
    <section className="earnings-heading"><div><div className="eyebrow">ROZLICZENIA 50/50</div><h1>{effectiveRole==='TECHNICIAN'?'Moje przychody':'Przychody punktów'}</h1><p>Serwisant zgłasza kwotę samodzielnie. Po zatwierdzeniu system zawsze dzieli ją po połowie: 50% dla Serwisanta i 50% dla Szefa.</p></div><button className="button secondary" onClick={()=>void load()} disabled={busy}><RefreshCw className={busy?'spin':''} size={16}/> Odśwież</button></section>

    {notice&&<div className="admin-notice">{notice}</div>}

    <section className="finance-stats"><article><BadgeDollarSign size={20}/><div><span>Zatwierdzony przychód</span><strong>{money(data?.summary.approvedRevenue??0)}</strong></div></article><article><div className="split-mark">50%</div><div><span>Część serwisantów</span><strong>{money(data?.summary.technicianShare??0)}</strong></div></article><article><div className="split-mark">50%</div><div><span>Część Szefa</span><strong>{money(data?.summary.bossShare??0)}</strong></div></article><article><Clock3 size={20}/><div><span>Oczekuje</span><strong>{money(data?.summary.pendingRevenue??0)}</strong></div></article></section>

    {canSubmit && <section className="panel-card revenue-form-card"><div className="panel-heading"><div><span className="eyebrow">SERWISANT</span><h2>Zgłoś przychód do weryfikacji</h2></div></div><div className="revenue-form-grid"><label><span>Kwota przychodu</span><input value={amount} onChange={e=>setAmount(e.target.value)} placeholder="np. 1200,00" inputMode="decimal"/></label><label><span>Data pracy</span><input type="date" value={workDate} onChange={e=>setWorkDate(e.target.value)}/></label><label><span>Punkt</span><select value={pointId} onChange={e=>setPointId(e.target.value)}>{auth.points.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label><label className="wide-field"><span>Notatka</span><textarea rows={3} value={note} onChange={e=>setNote(e.target.value)} placeholder="np. wymiana ekranu, bateria, diagnostyka"/></label></div><div className="split-preview"><span>Po zatwierdzeniu</span><strong>{money((Number(amount.replace(',','.'))||0)/2)} dla Ciebie</strong><strong>{money((Number(amount.replace(',','.'))||0)/2)} dla Szefa</strong></div><button className="button primary" onClick={()=>void submit()} disabled={busy}><Send size={16}/> Wyślij do weryfikacji</button></section>}

    {actualRole==='OWNER' && effectiveRole==='TECHNICIAN' && <div className="preview-info-card"><BadgeDollarSign size={18}/><div><strong>Podgląd interfejsu serwisanta</strong><span>Formularz wysyłania jest wyłączony, bo Twoja faktyczna rola to Właściciel aplikacji.</span></div></div>}

    {canReview && <section className="panel-card"><div className="panel-heading"><div><span className="eyebrow">WERYFIKACJA</span><h2>Oczekujące przychody</h2></div><div className="roadmap-count">{pending.length}</div></div><div className="revenue-review-list">{pending.length===0&&<div className="empty-admin">Brak przychodów oczekujących na weryfikację.</div>}{pending.map(entry=><article key={entry.id}><div><strong>{entry.technician?.name ?? 'Serwisant'}</strong><span>{entry.technician?.email}</span><small>{entry.point?.name} • {entry.workDate}</small></div><div className="revenue-amount"><span>Zgłoszono</span><strong>{money(entry.amount)}</strong><small>50/50 → {money(entry.amount/2)} / {money(entry.amount/2)}</small></div><p>{entry.note||'Brak notatki'}</p><div className="button-row"><button className="button small primary" onClick={()=>void review(entry,'APPROVE')}><CheckCircle2 size={14}/> Zatwierdź</button><button className="button small danger-soft" onClick={()=>void review(entry,'REJECT')}><XCircle size={14}/> Odrzuć</button></div></article>)}</div></section>}

    <section className="panel-card"><div className="panel-heading"><div><span className="eyebrow">HISTORIA</span><h2>Rozliczenia</h2></div></div><div className="revenue-history">{(data?.entries??[]).map(entry=><div key={entry.id}><div><strong>{money(entry.amount)}</strong><span>{entry.point?.name} • {entry.workDate}</span></div><span className={`revenue-status ${entry.status.toLowerCase()}`}>{entry.status==='APPROVED'?'Zatwierdzone':entry.status==='REJECTED'?'Odrzucone':'Oczekuje'}</span><div><small>Serwisant</small><strong>{money(entry.technicianShare)}</strong></div><div><small>Szef</small><strong>{money(entry.bossShare)}</strong></div></div>)}</div></section>
  </div>;
}
