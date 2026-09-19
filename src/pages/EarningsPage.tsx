import { useEffect, useState } from 'react';
import { BadgeDollarSign, RefreshCw, Save, Send } from 'lucide-react';
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
  const [pointId,setPointId] = useState(auth.point?.id ?? auth.points[0]?.id ?? '');
  const [note,setNote] = useState('');
  const [busy,setBusy] = useState(false);
  const [notice,setNotice] = useState('');

  const technicianMode = actualRole === 'TECHNICIAN' && effectiveRole === 'TECHNICIAN';
  const managementMode = effectiveRole === 'BOSS' || effectiveRole === 'OWNER';
  const parsedSplit = Number(splitInput.replace(',','.'));
  const validSplit = splitInput !== '' && Number.isFinite(parsedSplit) && parsedSplit >= 0 && parsedSplit <= 100;

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
      setNotice(e instanceof Error?e.message:'Nie udało się pobrać rozliczeń.');
    } finally{ setBusy(false); }
  };

  useEffect(()=>{ void load(); },[]);

  const saveSplit = async()=>{
    if(!validSplit){ setNotice('Ustaw procent od 0 do 100%.'); return; }
    setBusy(true); setNotice('');
    try{
      const next=await window.lockOn.finance.updateTechnicianSettings(parsedSplit);
      setSettings(next);
      setSplitInput(String(next.technicianPercent ?? ''));
      setNotice(`Zapisano: ${next.technicianPercent}% dla Ciebie i ${next.bossPercent}% dla Szefa. Nowy podział obowiązuje od kolejnych rozliczeń.`);
    }catch(e){
      setNotice(e instanceof Error?e.message:'Nie udało się zapisać rozliczenia.');
    }finally{ setBusy(false); }
  };

  const submit = async()=>{
    const parsed = Number(amount.replace(',','.'));
    if(!settings?.configured){ setNotice('Najpierw zapisz swój procent rozliczenia.'); return; }
    if(!Number.isFinite(parsed)||parsed<=0){ setNotice('Wpisz prawidłową kwotę.'); return; }
    if(!pointId){ setNotice('Wybierz punkt.'); return; }
    setBusy(true); setNotice('');
    try{
      const entry=await window.lockOn.finance.submit({amount:parsed,pointId,workDate,note});
      setAmount(''); setNote('');
      setNotice(`Wpis zapisany: ${entry.splitTechnicianPercent}% dla serwisanta / ${entry.splitBossPercent}% dla Szefa.`);
      await load();
    }catch(e){
      setNotice(e instanceof Error?e.message:'Nie udało się zapisać wpisu.');
    }finally{ setBusy(false); }
  };

  const previewAmount = Number(amount.replace(',','.')) || 0;
  const currentPercent = settings?.technicianPercent ?? (validSplit ? parsedSplit : null);
  const technicianPreview = currentPercent == null ? 0 : Math.round(previewAmount * currentPercent) / 100;
  const bossPreview = Math.round((previewAmount-technicianPreview)*100)/100;

  return <div className="earnings-page earnings-simple page-enter">
    <section className="earnings-simple-head">
      <div>
        <div className="eyebrow">ROZLICZENIA</div>
        <h1>{effectiveRole==='TECHNICIAN' ? 'Moje rozliczenia' : 'Rozliczenia'}</h1>
        <p>{managementMode ? 'Przychód firmy, udziały serwisantów i rozliczenia każdego punktu w jednym widoku.' : 'Ustaw swój procent, sprawdź kwoty i historię zakończonych prac.'}</p>
      </div>
      <button className="button secondary small" onClick={()=>void load()} disabled={busy}><RefreshCw className={busy?'spin':''} size={15}/> Odśwież</button>
    </section>

    {notice && <div className="admin-notice">{notice}</div>}

    {technicianMode && <section className={`settlement-simple-card ${settings?.configured?'configured':'needs-config'}`}>
      <div className="settlement-simple-copy">
        <span>TWÓJ PODZIAŁ</span>
        <strong>{settings?.configured && settings.technicianPercent != null ? `${settings.technicianPercent}%` : 'Ustaw procent'}</strong>
        <small>Zmiana dotyczy tylko nowych rozliczeń. Historia zachowuje wcześniejsze wartości.</small>
      </div>
      <div className="settlement-simple-edit">
        <label><span>Twój procent</span><div><input type="number" min="0" max="100" step="0.01" value={splitInput} onChange={e=>setSplitInput(e.target.value)} placeholder="60"/><b>%</b></div></label>
        <div className="settlement-simple-split">
          <span>Ty <strong>{validSplit ? parsedSplit : '—'}%</strong></span>
          <span>Szef <strong>{validSplit ? Math.round((100-parsedSplit)*100)/100 : '—'}%</strong></span>
        </div>
        <button className="button primary small" onClick={()=>void saveSplit()} disabled={busy||!validSplit}><Save size={15}/> Zapisz</button>
      </div>
    </section>}

    <section className="settlement-summary-grid">
      <article><span>Przychód</span><strong>{money(data?.summary.approvedRevenue??0)}</strong></article>
      <article><span>{effectiveRole==='TECHNICIAN'?'Dla mnie':'Serwisanci'}</span><strong>{money(data?.summary.technicianShare??0)}</strong></article>
      <article><span>Firma / Szef</span><strong>{money(data?.summary.bossShare??0)}</strong></article>
    </section>

    {actualRole==='OWNER' && effectiveRole==='TECHNICIAN' && <div className="preview-info-card"><BadgeDollarSign size={18}/><div><strong>Podgląd serwisanta</strong><span>Ustawienie własnego procentu jest wyłączone w podglądzie roli OWNER.</span></div></div>}

    {managementMode && <section className="panel-card boss-settlement-card">
      <div className="settlement-section-head">
        <div><span>PUNKTY</span><h2>Rozliczenia firmy per punkt</h2></div>
        <small>Kwoty i procent przy każdym wpisie są snapshotem historycznym.</small>
      </div>
      <div className="boss-point-list">
        {(data?.points ?? []).map((point)=><details key={point.pointId} className="boss-point-settlement">
          <summary>
            <div><strong>{point.pointName}</strong><span>{point.pointCity || 'Punkt ServiceOS'} · {point.entries.length} wpisów</span></div>
            <div className="boss-point-totals">
              <span>Przychód <strong>{money(point.approvedRevenue)}</strong></span>
              <span>Serwisanci <strong>{money(point.technicianShare)}</strong></span>
              <span>Firma / Szef <strong>{money(point.bossShare)}</strong></span>
            </div>
          </summary>
          <div className="boss-point-entries">
            {point.entries.map((entry)=><article key={entry.id}>
              <div><strong>{entry.orderNumber != null ? `Zlecenie #${entry.orderNumber}` : 'Wpis ręczny'}</strong><span>{entry.technician?.name || 'Serwisant'} · {entry.workDate}</span></div>
              <span>{money(entry.amount)}</span>
              <span>{entry.splitTechnicianPercent}% / {entry.splitBossPercent}%</span>
              <span>{money(entry.technicianShare)} / {money(entry.bossShare)}</span>
            </article>)}
          </div>
        </details>)}
        {(data?.points ?? []).length===0 && <div className="settlement-empty">Brak rozliczeń punktów.</div>}
      </div>
    </section>}

    <section className="panel-card settlement-history-card">
      <div className="settlement-section-head">
        <div><span>HISTORIA</span><h2>Ostatnie rozliczenia</h2></div>
        <small>Każdy wpis zachowuje procent użyty przy danej pracy.</small>
      </div>
      <div className="settlement-history-list">
        {(data?.entries??[]).map(entry=><article key={entry.id}>
          <div className="settlement-history-main">
            <strong>{money(entry.amount)}</strong>
            <span>{entry.point?.name || 'Punkt'} · {entry.workDate}</span>
            <small>{entry.orderNumber != null ? `Zlecenie #${entry.orderNumber}` : entry.serviceOrderId ? 'Zlecenie serwisowe' : 'Wpis ręczny'} · {entry.splitTechnicianPercent}% / {entry.splitBossPercent}%</small>
          </div>
          <div className="settlement-history-share"><span>Serwisant</span><strong>{money(entry.technicianShare)}</strong></div>
          <div className="settlement-history-share"><span>Szef</span><strong>{money(entry.bossShare)}</strong></div>
          <span className={`revenue-status ${entry.status.toLowerCase()}`}>{entry.status==='SETTLED'?'Rozliczone':'Zapisane'}</span>
        </article>)}
        {(data?.entries??[]).length===0 && <div className="settlement-empty">Brak rozliczeń.</div>}
      </div>
    </section>

    {technicianMode && <details className="panel-card settlement-extra">
      <summary>Dodaj przychód bez zlecenia</summary>
      <p>Użyj tylko wtedy, gdy praca nie ma własnej karty serwisowej.</p>
      <div className="settlement-extra-grid">
        <label><span>Kwota</span><input value={amount} onChange={e=>setAmount(e.target.value)} placeholder="np. 1200,00" inputMode="decimal"/></label>
        <label><span>Data</span><input type="date" value={workDate} onChange={e=>setWorkDate(e.target.value)}/></label>
        <label><span>Punkt</span><select value={pointId} onChange={e=>setPointId(e.target.value)}>{auth.points.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label>
        <label className="wide-field"><span>Notatka</span><input value={note} onChange={e=>setNote(e.target.value)} placeholder="Krótki opis pracy"/></label>
      </div>
      <div className="settlement-extra-preview">
        <span>Podział tego wpisu</span>
        <strong>{settings?.configured ? `${money(technicianPreview)} / ${money(bossPreview)}` : 'Najpierw ustaw procent'}</strong>
      </div>
      <button className="button primary small" onClick={()=>void submit()} disabled={busy||!settings?.configured}><Send size={15}/> Zapisz wpis</button>
    </details>}
  </div>;
}
