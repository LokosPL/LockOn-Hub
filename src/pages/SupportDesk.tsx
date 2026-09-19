import { useEffect, useState } from 'react';
import { Headphones, MessageSquareText, RefreshCw, Send, ShieldCheck } from 'lucide-react';
import type { UserRole } from '../config/roles';
import type { SupportTicket } from '../types/electron';

interface SupportDeskProps { role: UserRole; onOpenChat: () => void; }

export function SupportDesk({ role, onOpenChat }: SupportDeskProps) {
  const isConsultant = role === 'OWNER' || role === 'BOSS' || role === 'SUPPORT';
  const [tickets,setTickets]=useState<SupportTicket[]>([]);
  const [drafts,setDrafts]=useState<Record<string,string>>({});
  const [error,setError]=useState('');
  const load=async()=>{ if(!isConsultant)return; try{setTickets(await window.lockOn.support.listTickets());setError('');}catch(e){setError(e instanceof Error?e.message:'Nie udało się pobrać zgłoszeń.');}};
  useEffect(()=>{void load();},[isConsultant]);

  return <div className="support-page page-enter">
    <section className="support-hero"><div><div className="eyebrow"><span className="live-dot"/> POMOC LOCKON</div><h1>{isConsultant?'Zgłoszenia konsultanta':'Pomoc w ServiceOS'}</h1><p>{isConsultant?'Widzisz zgłoszenia wyłącznie z punktów w swoim zakresie.':'Możesz porozmawiać z pomocą automatyczną albo poprosić konsultanta o pomoc.'}</p><button className="button primary" onClick={onOpenChat}><MessageSquareText size={17}/> Otwórz pomoc</button></div><div className="support-hero-icon"><Headphones size={30}/></div></section>
    {error&&<div className="error-banner">{error}</div>}
    {isConsultant ? <section className="panel-card" style={{padding:18}}>
      <div className="section-head"><div><span>ZGŁOSZENIA</span><h2>Kolejka wsparcia</h2></div><button className="button small secondary" onClick={()=>void load()}><RefreshCw size={14}/> Odśwież</button></div>
      <div className="support-ticket-list">
        {tickets.map(ticket=><article className="support-ticket-card" key={ticket.id}>
          <div><strong>{ticket.userName}</strong><span>{ticket.pointName} · {ticket.status==='OPEN'?'Otwarte':'Zamknięte'}</span><small>{ticket.userEmail} · {new Date(ticket.updatedAt).toLocaleString('pl-PL')}</small></div>
          <div className="support-ticket-messages">{ticket.messages.slice(-6).map(m=><p key={m.id}><b>{m.author==='support'?'Konsultant':m.author==='user'?'Użytkownik':'ServiceOS'}:</b> {m.text}</p>)}</div>
          {ticket.status==='OPEN'&&<div className="support-ticket-actions">
            <button className="button small secondary" onClick={async()=>{await window.lockOn.support.take(ticket.id);await load();}}>Przejmij</button>
            <input value={drafts[ticket.id]||''} onChange={e=>setDrafts(v=>({...v,[ticket.id]:e.target.value}))} placeholder="Odpowiedź dla użytkownika"/>
            <button className="button small primary" disabled={!(drafts[ticket.id]||'').trim()} onClick={async()=>{await window.lockOn.support.reply(ticket.id,drafts[ticket.id]);setDrafts(v=>({...v,[ticket.id]:''}));await load();}}><Send size={13}/> Odpowiedz</button>
            <button className="button small secondary" onClick={async()=>{await window.lockOn.support.close(ticket.id);await load();}}>Zamknij</button>
          </div>}
        </article>)}
        {!tickets.length&&<div className="service-empty">Brak zgłoszeń w Twoim zakresie punktów.</div>}
      </div>
    </section> : <section className="support-grid compact-support-grid"><article className="panel-card support-card"><ShieldCheck size={20}/><span>Zakres</span><strong>Twój punkt</strong><small>Zgłoszenie trafia wyłącznie do konsultantów obsługujących Twój punkt.</small></article></section>}
  </div>;
}
