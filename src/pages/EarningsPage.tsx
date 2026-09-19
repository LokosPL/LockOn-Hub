import { useEffect, useMemo, useState } from 'react';
import { BadgeDollarSign, RefreshCw, Save, Send, Sparkles } from 'lucide-react';
import type { AuthState, FinancePayload, TechnicianSettlementSettings } from '../types/electron';
import type { UserRole } from '../config/roles';

const money = (value:number) => new Intl.NumberFormat('pl-PL',{style:'currency',currency:'PLN'}).format(value || 0);
const today = new Date().toISOString().slice(0,10);

interface Props { auth: AuthState; effectiveRole: UserRole; }

export function EarningsPage({ auth, effectiveRole }: Props) {
  const actualRole = auth.role as UserRole;
  const [data,setData] = useState<FinancePayload | null>(null);
  const [settings,setSettings] = useState<TechnicianSettlementSettings | null>(null);
  const [splitInput,setSplitInput] = useState(auth.technicianSplitPercent == null ? '' : String(auth.technicianSplitPercent));
  const [amount,setAmount] = useState('');
  const [workDate,setWorkDate] = useState(today);
  const [pointId,setPointId] = useState(auth.point?.id ?? '');
  const [note,setNote] = useState('');
  const [busy,setBusy] = useState(false);
  const [notice,setNotice] = useState('');

  const canConfigure = actualRole === 'TECHNICIAN' && effectiveRole === 'TECHNICIAN';
  const canSubmit = canConfigure;
  const parsedSplit = Number(splitInput.replace(',','.'));
  const validSplit = splitInput !== '' && Number.isFinite(parsedSplit) && parsedSplit >= 0 && parsedSplit <= 100;
  const splitForPreview = settings?.configured && settings.technicianPercent != null ? settings.technicianPercent : (validSplit ? parsedSplit : null);

  const load = async()=>{
    setBusy(true);
    try{
      if(actualRole === 'TECHNICIAN'){
        const [finance,profile] = await Promise.all([
          window.lockOn.finance.list(),
          window.lockOn.finance.getTechnicianSettings()
        ]);
        setData(finance);
        setSettings(profile);
        setSplitInput(profile.technicianPercent == null ? '' : String(profile.technicianPercent));
      } else {
        setData(await window.lockOn.finance.list());
      }
    } catch(e){
      setNotice(e instanceof Error?e.message:'Błąd rozliczeń.');
    } finally{setBusy(false);}
  };
  useEffect(()=>{ void load(); },[]);

  const autoEntries = useMemo(()=>data?.entries.filter(entry=>Boolean(entry.serviceOrderId)) ?? [],[data]);
  const manualEntries = useMemo(()=>data?.entries.filter(entry=>!entry.serviceOrderId) ?? [],[data]);

  const saveSplit = async()=>{
    if(!validSplit){setNotice('Ustaw procent serwisanta od 0 do 100%.');return;}
    setBusy(true);setNotice('');
    try{
      const next=await window.lockOn.finance.updateTechnicianSettings(parsedSplit);
      setSettings(next);
      setSplitInput(String(next.technicianPercent ?? ''));
      setNotice(`Zapisano rozliczenie: ${next.technicianPercent}% dla serwisanta i ${next.bossPercent}% dla Szefa. Dotyczy nowych rozliczeń.`);
    }catch(e){
      setNotice(e instanceof Error?e.message:'Nie udało się zapisać ustawień rozliczenia.');
    }finally{setBusy(false);}
  };

  const submit = async()=>{
    const parsed = Number(amount.replace(',','.'));
    if(!settings?.configured){setNotice('Najpierw ustaw i zapisz swój procent rozliczenia.');return;}
    if(!Number.isFinite(parsed)||parsed<=0){setNotice('Wpisz prawidłową kwotę.');return;}
    if(!pointId){setNotice('Wybierz punkt.');return;}
    setBusy(true);setNotice('');
    try{
      const entry=await window.lockOn.finance.submit({amount:parsed,pointId,workDate,note});
      setAmount('');
      setNote('');
      setNotice(`Przychód zapisany. Podział: ${entry.splitTechnicianPercent}% serwisant / ${entry.splitBossPercent}% Szef.`);
      await load();
    } catch(e){
      setNotice(e instanceof Error?e.message:'Nie udało się zapisać przychodu.');
    } finally{setBusy(false);}
  };

  const previewAmount = Number(amount.replace(',','.')) || 0;
  const technicianPreview = splitForPreview == null ? 0 : Math.round(previewAmount * splitForPreview) / 100;
  const bossPreview = Math.round((previewAmount-technicianPreview)*100)/100;

  return <div className="earnings-page page-enter">
    <section className="earnings-heading">
      <div>
        <div className="eyebrow">ROZLICZENIA SERWISOWE</div>
        <h1>{effectiveRole==='TECHNICIAN'?'Moje rozliczenia':'Rozliczenia punktów'}</h1>
        <p>Każdy serwisant ma własny procent rozliczenia. Zakończone zlecenie trafia tutaj automatycznie z procentem obowiązującym dla przypisanego serwisanta w chwili zamknięcia naprawy.</p>
      </div>
      <button className="button secondary" onClick={()=>void load()} disabled={busy}><RefreshCw className={busy?'spin':''} size={16}/> Odśwież</button>
    </section>

    {notice&&<div className="admin-notice">{notice}</div>}

    {canConfigure && <section className={`panel-card technician-settlement-card ${settings?.configured?'configured':'needs-config'}`}>
      <div className="panel-heading">
        <div>
          <span className="eyebrow">MOJE ROZLICZENIE</span>
          <h2>{settings?.configured?'Ustalony podział':'Ustaw rozliczenie przed pierwszym zamknięciem naprawy'}</h2>
          <p>To ustawienie dotyczy nowych rozliczeń. Zmiana procentu nie modyfikuje historii już zakończonych zleceń.</p>
        </div>
      </div>
      <div className="technician-settlement-editor">
        <label><span>Twój udział (%)</span><input type="number" min="0" max="100" step="0.01" value={splitInput} onChange={e=>setSplitInput(e.target.value)} placeholder="np. 60"/></label>
        <div className="settlement-live-preview">
          <span>Serwisant <strong>{validSplit?parsedSplit:'—'}%</strong></span>
          <span>Szef <strong>{validSplit?Math.round((100-parsedSplit)*100)/100:'—'}%</strong></span>
        </div>
        <button className="button primary" onClick={()=>void saveSplit()} disabled={busy||!validSplit}><Save size={16}/> Zapisz moje rozliczenie</button>
      </div>
    </section>}

    <section className="finance-stats">
      <article><BadgeDollarSign size={20}/><div><span>Rozliczony przychód</span><strong>{money(data?.summary.approvedRevenue??0)}</strong></div></article>
      <article><div className="split-mark">SERWIS</div><div><span>Część serwisantów</span><strong>{money(data?.summary.technicianShare??0)}</strong></div></article>
      <article><div className="split-mark">FIRMA</div><div><span>Część Szefa</span><strong>{money(data?.summary.bossShare??0)}</strong></div></article>
      <article><Sparkles size={20}/><div><span>Automatyczne zlecenia</span><strong>{autoEntries.length}</strong></div></article>
    </section>

    <section className="panel-card revenue-auto-card">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">ZLECENIA SERWISOWE</span>
          <h2>Automatycznie po zakończeniu</h2>
          <p>Po ustawieniu statusu „Zakończone” ServiceOS zapisuje kwotę z karty zlecenia i procent przypisanego serwisanta. Każdy wpis zachowuje własny procent jako snapshot.</p>
        </div>
      </div>
      <div className="auto-settlement-strip">
        <span><strong>{autoEntries.length}</strong> automatycznych rozliczeń</span>
        <span><strong>{manualEntries.length}</strong> ręcznych wpisów</span>
        <span><strong>{settings?.technicianPercent ?? '—'}%</strong> Twój aktualny udział</span>
      </div>
    </section>

    {canSubmit && <section className="panel-card revenue-form-card">
      <div className="panel-heading"><div><span className="eyebrow">DODATKOWY PRZYCHÓD</span><h2>Dodaj ręczny wpis</h2><p>Używaj tylko dla pracy, która nie ma własnej karty zlecenia. Wpis użyje Twojego aktualnie zapisanego procentu.</p></div></div>
      <div className="revenue-form-grid">
        <label><span>Kwota przychodu</span><input value={amount} onChange={e=>setAmount(e.target.value)} placeholder="np. 1200,00" inputMode="decimal"/></label>
        <label><span>Data pracy</span><input type="date" value={workDate} onChange={e=>setWorkDate(e.target.value)}/></label>
        <label><span>Punkt</span><select value={pointId} onChange={e=>setPointId(e.target.value)}>{auth.points.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label>
        <label className="wide-field"><span>Notatka</span><textarea rows={3} value={note} onChange={e=>setNote(e.target.value)} placeholder="np. usługa poza kartą zlecenia"/></label>
      </div>
      <div className="split-preview">
        <span>{settings?.configured?'Podział bieżącego wpisu':'Najpierw zapisz swój procent'}</span>
        <strong>{settings?.configured?money(technicianPreview):'—'} dla Ciebie</strong>
        <strong>{settings?.configured?money(bossPreview):'—'} dla Szefa</strong>
      </div>
      <button className="button primary" onClick={()=>void submit()} disabled={busy||!settings?.configured}><Send size={16}/> Dodaj do rozliczeń</button>
    </section>}

    {actualRole==='OWNER' && effectiveRole==='TECHNICIAN' && <div className="preview-info-card"><BadgeDollarSign size={18}/><div><strong>Podgląd interfejsu serwisanta</strong><span>Zmiana indywidualnego procentu jest wyłączona, bo Twoja faktyczna rola to Właściciel aplikacji.</span></div></div>}

    <section className="panel-card">
      <div className="panel-heading"><div><span className="eyebrow">HISTORIA</span><h2>Rozliczenia</h2><p>Przy każdym wpisie widoczny jest procent zapisany dla tej konkretnej pracy.</p></div></div>
      <div className="revenue-history">{(data?.entries??[]).map(entry=><div key={entry.id}>
        <div>
          <strong>{money(entry.amount)}</strong>
          <span>{entry.point?.name} • {entry.workDate}</span>
          <small>{entry.serviceOrderId ? 'Automatycznie ze zlecenia serwisowego' : 'Ręczny wpis'} · {entry.splitTechnicianPercent}% / {entry.splitBossPercent}%</small>
        </div>
        <span className={`revenue-status ${entry.status.toLowerCase()}`}>{entry.status==='SETTLED'?'Rozliczone':'Zatwierdzone'}</span>
        <div><small>Serwisant · {entry.splitTechnicianPercent}%</small><strong>{money(entry.technicianShare)}</strong></div>
        <div><small>Szef · {entry.splitBossPercent}%</small><strong>{money(entry.bossShare)}</strong></div>
      </div>)}</div>
    </section>
  </div>;
}
