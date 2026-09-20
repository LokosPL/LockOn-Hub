import { useEffect, useMemo, useState } from 'react';
import {
  Bot, CircleDot, Clock3, Headphones, MessageSquareText, RefreshCw, Send, ShieldCheck,
  UserRoundCheck, UsersRound, XCircle
} from 'lucide-react';
import type { UserRole } from '../config/roles';
import type { SupportPresence, SupportTicket } from '../types/electron';

interface SupportDeskProps {
  role: UserRole;
  supportEnabled?: boolean;
  onOpenChat: () => void;
}

const roleLabel = (role: UserRole | null) => ({
  OWNER:'Właściciel',
  BOSS:'Szef',
  COORDINATOR:'Koordynator',
  SUPPORT:'Wsparcie (starszy profil)',
  TECHNICIAN:'Serwisant',
  USER:'Pracownik punktu'
}[role || 'USER'] || 'Pracownik');

const stateLabel = (state: SupportPresence['consultantState']) => ({
  BOT:'Rozmawia z botem',
  WAITING:'Czeka na konsultanta',
  JOINED:'Konsultant w rozmowie'
}[state]);

export function SupportDesk({ role, supportEnabled = false, onOpenChat }: SupportDeskProps) {
  const isConsultant = role === 'OWNER' || role === 'SUPPORT' || supportEnabled;
  const [tickets,setTickets]=useState<SupportTicket[]>([]);
  const [presence,setPresence]=useState<SupportPresence[]>([]);
  const [selectedId,setSelectedId]=useState<string | null>(null);
  const [draft,setDraft]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');

  const selected = useMemo(
    () => tickets.find((ticket)=>ticket.id===selectedId) ?? tickets.find((ticket)=>ticket.status==='OPEN') ?? tickets[0] ?? null,
    [tickets,selectedId]
  );

  const load=async(silent=false)=>{
    if(!isConsultant)return;
    try{
      const [nextTickets,nextPresence]=await Promise.all([
        window.lockOn.support.listTickets(),
        window.lockOn.support.presence()
      ]);
      setTickets(nextTickets);
      setPresence(nextPresence);
      setSelectedId((current)=>current && nextTickets.some((item)=>item.id===current)
        ? current
        : nextTickets.find((item)=>item.status==='OPEN')?.id ?? nextTickets[0]?.id ?? null);
      if(!silent)setError('');
    }catch(e){
      if(!silent)setError(e instanceof Error?e.message:'Nie udało się pobrać wsparcia.');
    }
  };

  useEffect(()=>{
    if(!isConsultant)return;
    void load();
    const timer=window.setInterval(()=>{
      if(document.visibilityState==='visible')void load(true);
    },4000);
    return()=>window.clearInterval(timer);
  },[isConsultant]);

  const take=async(ticket:SupportTicket)=>{
    setBusy(true);setError('');
    try{
      await window.lockOn.support.take(ticket.id);
      await load(true);
      setSelectedId(ticket.id);
    }catch(e){setError(e instanceof Error?e.message:'Nie udało się dołączyć do rozmowy.');}
    finally{setBusy(false);}
  };

  const reply=async()=>{
    if(!selected||!draft.trim()||busy)return;
    setBusy(true);setError('');
    try{
      if(!selected.assignedSupportUserId) await window.lockOn.support.take(selected.id);
      await window.lockOn.support.reply(selected.id,draft.trim());
      setDraft('');
      await load(true);
      setSelectedId(selected.id);
    }catch(e){setError(e instanceof Error?e.message:'Nie udało się wysłać odpowiedzi.');}
    finally{setBusy(false);}
  };

  const close=async(ticket:SupportTicket)=>{
    if(!window.confirm('Zamknąć tę rozmowę wsparcia?'))return;
    setBusy(true);setError('');
    try{
      await window.lockOn.support.close(ticket.id);
      await load(true);
    }catch(e){setError(e instanceof Error?e.message:'Nie udało się zamknąć rozmowy.');}
    finally{setBusy(false);}
  };

  const waitingCount=tickets.filter((ticket)=>ticket.status==='OPEN'&&!ticket.assignedSupportUserId).length;
  const joinedCount=tickets.filter((ticket)=>ticket.status==='OPEN'&&ticket.assignedSupportUserId).length;

  if(!isConsultant){
    return <div className="support-page page-enter">
      <section className="support-hero">
        <div><div className="eyebrow"><span className="live-dot"/> POMOC LOCKON</div><h1>Pomoc w ServiceOS</h1>
          <p>Najpierw zapytaj bota. Jeżeli to nie wystarczy, z tej samej rozmowy możesz poprosić konsultanta o dołączenie.</p>
          <button className="button primary" onClick={onOpenChat}><MessageSquareText size={17}/> Otwórz pomoc</button>
        </div>
        <div className="support-hero-icon"><Headphones size={30}/></div>
      </section>
      <section className="support-grid compact-support-grid">
        <article className="panel-card support-card"><Bot size={20}/><span>Krok 1</span><strong>Bot zna ServiceOS</strong><small>Może znaleźć zlecenie, wyjaśnić proces i otworzyć właściwy ekran.</small></article>
        <article className="panel-card support-card"><Headphones size={20}/><span>Krok 2</span><strong>Konsultant na żądanie</strong><small>Rozmowa trafia do człowieka dopiero, gdy sam poprosisz o pomoc.</small></article>
      </section>
    </div>;
  }

  return <div className="support-page page-enter support-desk-v2">
    <section className="support-hero">
      <div>
        <div className="eyebrow"><span className="live-dot"/> WSPARCIE LOCKON</div>
        <h1>Centrum pomocy zespołu</h1>
        <p>Widzisz aktywnych pracowników. Po prośbie użytkownika obsługujesz tylko kanał konsultanta — jego prywatne wiadomości do bota pozostają niewidoczne.</p>
        <button className="button secondary" onClick={onOpenChat}><Bot size={16}/> Otwórz własnego bota</button>
      </div>
      <div className="support-hero-icon"><Headphones size={30}/></div>
    </section>

    {error&&<div className="error-banner">{error}</div>}

    <section className="support-live-stats">
      <article><UsersRound size={18}/><div><span>Aktywni teraz</span><strong>{presence.length}</strong></div></article>
      <article className={waitingCount?'attention':''}><Clock3 size={18}/><div><span>Czekają na człowieka</span><strong>{waitingCount}</strong></div></article>
      <article><UserRoundCheck size={18}/><div><span>Rozmowy przejęte</span><strong>{joinedCount}</strong></div></article>
    </section>

    <div className="support-workspace">
      <aside className="panel-card support-presence-panel">
        <div className="section-head">
          <div><span>AKTYWNOŚĆ</span><h2>Użytkownicy online</h2></div>
          <button className="button small secondary" onClick={()=>void load()}><RefreshCw size={14}/></button>
        </div>
        <div className="support-presence-list">
          {presence.map((person)=>{
            const canOpen=Boolean(person.conversationId);
            return <button
              key={person.userId}
              type="button"
              className={'support-presence-row '+person.consultantState.toLowerCase()}
              disabled={!canOpen}
              onClick={()=>{
                if(!person.conversationId)return;
                setSelectedId(person.conversationId);
              }}
            >
              <i><CircleDot size={13}/></i>
              <span><strong>{person.name}</strong><small>{roleLabel(person.role)} · {(person.clientTypes||[]).map(type=>type==='WEB'?'telefon / WWW':'desktop').join(' + ')}</small></span>
              <em>{stateLabel(person.consultantState)}</em>
            </button>;
          })}
          {!presence.length&&<div className="service-empty">Brak aktywnych użytkowników w Twoim zakresie.</div>}
        </div>
        <div className="support-privacy-note"><ShieldCheck size={15}/><span>Użytkownik przy bocie jest widoczny jako aktywny, ale jego rozmowa pozostaje prywatna do chwili prośby o konsultanta.</span></div>
      </aside>

      <section className="panel-card support-conversation-panel">
        <div className="section-head">
          <div><span>ROZMOWY</span><h2>{selected ? selected.userName : 'Kolejka konsultanta'}</h2></div>
          {selected&&<span className={'support-ticket-state '+(selected.assignedSupportUserId?'joined':'waiting')}>
            {selected.assignedSupportUserId ? 'Konsultant dołączył' : 'Czeka na konsultanta'}
          </span>}
        </div>

        <div className="support-ticket-switcher">
          {tickets.filter(ticket=>ticket.status==='OPEN').map(ticket=>
            <button key={ticket.id} className={selected?.id===ticket.id?'active':''} onClick={()=>setSelectedId(ticket.id)}>
              <span>{ticket.userName}</span><small>{ticket.pointName}</small>
              {!ticket.assignedSupportUserId&&<b>NOWA PROŚBA</b>}
            </button>
          )}
        </div>

        {selected ? <>
          <div className="support-conversation-head">
            <div><strong>{selected.userName}</strong><span>{selected.userEmail} · {selected.pointName}</span></div>
            <div><small>Prośba: {selected.consultantRequestedAt ? new Date(selected.consultantRequestedAt).toLocaleString('pl-PL') : '—'}</small>
              <small>{selected.assignedSupportName ? 'Obsługuje: '+selected.assignedSupportName : 'Nikt jeszcze nie dołączył'}</small></div>
          </div>

          <div className="support-thread">
            {selected.messages.map((message)=><article key={message.id} className={'support-thread-message '+message.author}>
              <header><strong>{message.author==='support'?'Konsultant':message.author==='user'?selected.userName:message.author==='assistant'?'Bot ServiceOS':'ServiceOS'}</strong>
                <time>{new Date(message.createdAt).toLocaleString('pl-PL')}</time></header>
              <p>{message.text}</p>
            </article>)}
          </div>

          {selected.status==='OPEN'&&<div className="support-consultant-compose">
            {!selected.assignedSupportUserId&&<button className="button primary" disabled={busy} onClick={()=>void take(selected)}><UserRoundCheck size={14}/> Dołącz do rozmowy</button>}
            <textarea value={draft} maxLength={2000} onChange={(event)=>setDraft(event.target.value)}
              onKeyDown={(event)=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();void reply();}}}
              placeholder="Napisz odpowiedź do użytkownika…" rows={2}/>
            <button className="button primary" disabled={busy||!draft.trim()} onClick={()=>void reply()}><Send size={14}/> Wyślij</button>
            <button className="button secondary" disabled={busy} onClick={()=>void close(selected)}><XCircle size={14}/> Zakończ kanał</button>
          </div>}
        </> : <div className="support-empty-workspace"><Headphones size={28}/><strong>Nikt nie czeka na konsultanta.</strong><span>Aktywni użytkownicy korzystający tylko z bota pozostają po lewej stronie bez dostępu do ich treści rozmowy.</span></div>}
      </section>
    </div>
  </div>;
}
