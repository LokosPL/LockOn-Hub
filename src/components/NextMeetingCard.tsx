import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Radio, UsersRound } from 'lucide-react';
import type { MeetingSummary } from '../types/electron';

export function NextMeetingCard({ onOpen }: { onOpen: () => void }) {
  const [meetings,setMeetings]=useState<MeetingSummary[]>([]);
  useEffect(()=>{
    let active=true;
    const load=()=>void window.lockOn.meetings.list().then((data)=>{if(active)setMeetings(data.meetings??[]);}).catch(()=>undefined);
    load();
    const timer=window.setInterval(load,30_000);
    return ()=>{active=false;window.clearInterval(timer);};
  },[]);
  const meeting=useMemo(()=>meetings
    .filter((item)=>item.status==='LIVE'||item.status==='SCHEDULED')
    .sort((a,b)=>a.status===b.status?new Date(a.startsAt).getTime()-new Date(b.startsAt).getTime():a.status==='LIVE'?-1:1)[0]??null,[meetings]);
  if(!meeting)return (
    <section className="start-next-meeting empty">
      <div><span>SPOTKANIA I SZKOLENIA</span><h2>Brak najbliższych spotkań.</h2><p>Otwórz moduł, aby zobaczyć historię albo zaplanować spotkanie, jeśli masz uprawnienia.</p></div>
      <button className="button secondary" onClick={onOpen}>Otwórz spotkania</button>
    </section>
  );
  const date=new Date(meeting.startsAt);
  return (
    <section className={'start-next-meeting '+(meeting.status==='LIVE'?'live':'')}>
      <div className="start-next-meeting-title">
        <span>{meeting.status==='LIVE'?<><Radio size={13}/> ● TRWA TERAZ</>:'NAJBLIŻSZE SPOTKANIE'}</span>
        <h2>{meeting.title}</h2>
        {meeting.description&&<p>{meeting.description}</p>}
      </div>
      <div className="start-next-meeting-meta">
        <div><CalendarDays size={15}/><span><small>Data</small><strong>{date.toLocaleDateString('pl-PL',{day:'2-digit',month:'long'})}</strong></span></div>
        <div><span><small>Godzina</small><strong>{date.toLocaleTimeString('pl-PL',{hour:'2-digit',minute:'2-digit'})}</strong></span></div>
        <div><span><small>Prowadzący</small><strong>{meeting.hostName}</strong></span></div>
        <div><UsersRound size={15}/><span><small>Zapisanych</small><strong>{meeting.registeredCount}/{meeting.maxParticipants}</strong></span></div>
      </div>
      <button className={'button '+(meeting.status==='LIVE'?'primary':'secondary')} onClick={onOpen}>{meeting.status==='LIVE'?'Dołącz / zobacz pokój':'Zobacz szczegóły'}</button>
    </section>
  );
}
