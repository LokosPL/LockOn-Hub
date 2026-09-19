import { useEffect, useMemo, useState } from 'react';
import { BadgeDollarSign, RefreshCw, Send, Sparkles } from 'lucide-react';
import type { AuthState, FinancePayload } from '../types/electron';
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

  const load = async()=>{
    setBusy(true);
    try{ setData(await window.lockOn.finance.list()); }
    catch(e){ setNotice(e instanceof Error?e.message:'Błąd rozliczeń.'); }
    finally{setBusy(false);}
  };
  useEffect(()=>{ void load(); },[]);

  const canSubmit = actualRole === 'TECHNICIAN' && effectiveRole === 'TECHNICIAN';
  const autoEntries = useMemo(()=>data?.entries.filter(entry=>Boolean(entry.serviceOrderId)) ?? [],[data]);
  const manualEntries = useMemo(()=>data?.entries.filter(entry=>!entry.serviceOrderId) ?? [],[data]);

  const submit = async()=>{
    const parsed = Number(amount.replace(',','.'));
    if(!Number.isFinite(parsed)||parsed<=0){setNotice('Wpisz prawidłową kwotę.');return;}
    if(!pointId){setNotice('Wybierz punkt.');return;}
    setBusy(true);setNotice('');
    try{
      await window.lockOn.finance.submit({amount:parsed,pointId,workDate,note});
      setAmount('');
      setNote('');
      setNotice('Przychód został od razu zapisany w rozliczeniach i podzielony 50/50. Nie wymaga dodatkowej akceptacji.');
      await load();
    } catch(e){
      setNotice(e instanceof Error?e.message:'Nie udało się zapisać przychodu.');
    } finally{setBusy(false);}
  };

  return <div className="earnings-page page-enter">
    <section className="earnings-heading">
      <div>
        <div className="eyebrow">ROZLICZENIA 50/50 · AUTOMATYCZNIE</div>
        <h1>{effectiveRole==='TECHNICIAN'?'Moje rozliczenia':'Rozliczenia punktów'}</h1>
        <p>Zakończone zlecenie z kwotą końcową trafia tutaj automatycznie. Nie ma etapu weryfikacji: system od razu dzieli przychód po połowie — 50% dla serwisanta i 50% dla Szefa.</p>
      </div>
      <button className="button secondary" onClick={()=>void load()} disabled={busy}><RefreshCw className={busy?'spin':''} size={16}/> Odśwież</button>
    </section>

    {notice&&<div className="admin-notice">{notice}</div>}

    <section className="finance-stats">
      <article><BadgeDollarSign size={20}/><div><span>Rozliczony przychód</span><strong>{money(data?.summary.approvedRevenue??0)}</strong></div></article>
      <article><div className="split-mark">50%</div><div><span>Część serwisantów</span><strong>{money(data?.summary.technicianShare??0)}</strong></div></article>
      <article><div className="split-mark">50%</div><div><span>Część Szefa</span><strong>{money(data?.summary.bossShare??0)}</strong></div></article>
      <article><Sparkles size={20}/><div><span>Automatyczne zlecenia</span><strong>{autoEntries.length}</strong></div></article>
    </section>

    <section className="panel-card revenue-auto-card">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">ZLECENIA SERWISOWE</span>
          <h2>Bez ręcznej weryfikacji</h2>
          <p>Po ustawieniu statusu „Zakończone” ServiceOS zapisuje kwotę z karty zlecenia jako zatwierdzony przychód. Jeżeli koszt końcowy nie jest wpisany, używa zapisanej wyceny; gdy nie ma żadnej kwoty, poprosi o jej uzupełnienie przed zamknięciem.</p>
        </div>
      </div>
      <div className="auto-settlement-strip">
        <span><strong>{autoEntries.length}</strong> automatycznych rozliczeń</span>
        <span><strong>{manualEntries.length}</strong> ręcznych wpisów</span>
        <span><strong>0</strong> wymagających akceptacji</span>
      </div>
    </section>

    {canSubmit && <section className="panel-card revenue-form-card">
      <div className="panel-heading"><div><span className="eyebrow">DODATKOWY PRZYCHÓD</span><h2>Dodaj ręczny wpis</h2><p>Używaj tylko dla pracy, która nie ma własnej karty zlecenia. Wpis również rozlicza się od razu 50/50.</p></div></div>
      <div className="revenue-form-grid">
        <label><span>Kwota przychodu</span><input value={amount} onChange={e=>setAmount(e.target.value)} placeholder="np. 1200,00" inputMode="decimal"/></label>
        <label><span>Data pracy</span><input type="date" value={workDate} onChange={e=>setWorkDate(e.target.value)}/></label>
        <label><span>Punkt</span><select value={pointId} onChange={e=>setPointId(e.target.value)}>{auth.points.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label>
        <label className="wide-field"><span>Notatka</span><textarea rows={3} value={note} onChange={e=>setNote(e.target.value)} placeholder="np. usługa poza kartą zlecenia"/></label>
      </div>
      <div className="split-preview"><span>Od razu po zapisaniu</span><strong>{money((Number(amount.replace(',','.'))||0)/2)} dla Ciebie</strong><strong>{money((Number(amount.replace(',','.'))||0)/2)} dla Szefa</strong></div>
      <button className="button primary" onClick={()=>void submit()} disabled={busy}><Send size={16}/> Dodaj do rozliczeń</button>
    </section>}

    {actualRole==='OWNER' && effectiveRole==='TECHNICIAN' && <div className="preview-info-card"><BadgeDollarSign size={18}/><div><strong>Podgląd interfejsu serwisanta</strong><span>Ręczny formularz jest wyłączony, bo Twoja faktyczna rola to Właściciel aplikacji.</span></div></div>}

    <section className="panel-card">
      <div className="panel-heading"><div><span className="eyebrow">HISTORIA</span><h2>Rozliczenia</h2><p>Automatyczne wpisy są powiązane bezpośrednio ze zleceniem serwisowym.</p></div></div>
      <div className="revenue-history">{(data?.entries??[]).map(entry=><div key={entry.id}>
        <div>
          <strong>{money(entry.amount)}</strong>
          <span>{entry.point?.name} • {entry.workDate}</span>
          <small>{entry.serviceOrderId ? 'Automatycznie ze zlecenia serwisowego' : 'Ręczny wpis'}</small>
        </div>
        <span className={`revenue-status ${entry.status.toLowerCase()}`}>{entry.status==='SETTLED'?'Rozliczone':'Zatwierdzone'}</span>
        <div><small>Serwisant</small><strong>{money(entry.technicianShare)}</strong></div>
        <div><small>Szef</small><strong>{money(entry.bossShare)}</strong></div>
      </div>)}</div>
    </section>
  </div>;
}
