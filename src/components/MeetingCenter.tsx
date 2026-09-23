import { useEffect, useMemo, useState } from 'react';
import {
  CalendarClock, CheckCircle2, Clock3, Mic, MonitorUp, Plus, Radio,
  RefreshCw, Square, UserMinus, UserPlus, UsersRound, XCircle
} from 'lucide-react';
import type {
  MeetingAudienceOptions, MeetingAudienceType, MeetingCreateInput, MeetingSummary, UserRole
} from '../types/electron';
import { MeetingRoom } from './MeetingRoom';

interface MeetingCenterProps {
  role: UserRole;
  currentUserId?: string | null;
}

const localInputValue = (date = new Date(Date.now() + 60 * 60_000)) => {
  const pad=(value:number)=>String(value).padStart(2,'0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const statusLabel = (status:MeetingSummary['status']) => ({
  SCHEDULED:'Zaplanowane',
  LIVE:'Trwa teraz',
  ENDED:'Zakończone',
  CANCELLED:'Anulowane'
}[status]);

const audienceLabel = (type:MeetingAudienceType) => ({
  ALL:'Wszyscy pracownicy',
  POINTS:'Wybrane punkty',
  USERS:'Wybrane osoby'
}[type]);

const dateLabel = (value:string) => new Date(value).toLocaleString('pl-PL',{
  weekday:'short',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'
});

export function MeetingCenter({ role, currentUserId }: MeetingCenterProps) {
  const canHost=role==='OWNER'||role==='BOSS';
  const [meetings,setMeetings]=useState<MeetingSummary[]>([]);
  const [options,setOptions]=useState<MeetingAudienceOptions|null>(null);
  const [loading,setLoading]=useState(true);
  const [busyId,setBusyId]=useState<string|null>(null);
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');
  const [creating,setCreating]=useState(false);
  const [activeMeetingId,setActiveMeetingId]=useState<string|null>(null);
  const [form,setForm]=useState<MeetingCreateInput>({
    title:'',
    description:'',
    startsAt:localInputValue(),
    expectedDurationMinutes:60,
    audienceType:'ALL',
    pointIds:[],
    userIds:[],
    allowParticipantAudio:true,
    allowParticipantScreenShare:false,
    maxParticipants:50
  });

  const load=async(silent=false)=>{
    if(!silent)setLoading(true);
    try{
      const result=await window.lockOn.meetings.list();
      setMeetings(result.meetings??[]);
      setError('');
    }catch(e){
      if(!silent)setError(e instanceof Error?e.message:'Nie udało się pobrać spotkań.');
    }finally{
      if(!silent)setLoading(false);
    }
  };

  useEffect(()=>{
    void load();
    const timer=window.setInterval(()=>void load(true),15_000);
    return()=>window.clearInterval(timer);
  },[]);

  const upcoming=useMemo(()=>meetings
    .filter((item)=>item.status==='LIVE'||item.status==='SCHEDULED')
    .sort((a,b)=>{
      if(a.status==='LIVE'&&b.status!=='LIVE')return -1;
      if(b.status==='LIVE'&&a.status!=='LIVE')return 1;
      return new Date(a.startsAt).getTime()-new Date(b.startsAt).getTime();
    }),[meetings]);
  const primary=upcoming[0]??null;
  const later=upcoming.slice(1,5);
  const activeMeeting=activeMeetingId?meetings.find((item)=>item.id===activeMeetingId)??null:null;

  const openCreate=async()=>{
    setCreating(true);setError('');setNotice('');
    if(options)return;
    try{setOptions(await window.lockOn.meetings.getAudienceOptions());}
    catch(e){setError(e instanceof Error?e.message:'Nie udało się pobrać listy uczestników.');}
  };

  const patch=<K extends keyof MeetingCreateInput>(key:K,value:MeetingCreateInput[K])=>
    setForm((current)=>({...current,[key]:value}));

  const togglePoint=(id:string)=>setForm((current)=>({
    ...current,
    pointIds:(current.pointIds??[]).includes(id)?(current.pointIds??[]).filter((item)=>item!==id):[...(current.pointIds??[]),id]
  }));
  const toggleUser=(id:string)=>setForm((current)=>({
    ...current,
    userIds:(current.userIds??[]).includes(id)?(current.userIds??[]).filter((item)=>item!==id):[...(current.userIds??[]),id]
  }));

  const createMeeting=async()=>{
    if(!form.title.trim()){setError('Podaj tytuł spotkania.');return;}
    const startsAt=new Date(form.startsAt);
    if(Number.isNaN(startsAt.getTime())){setError('Podaj poprawny termin spotkania.');return;}
    setBusyId('create');setError('');setNotice('');
    try{
      await window.lockOn.meetings.create({...form,title:form.title.trim(),description:form.description?.trim()||'',startsAt:startsAt.toISOString()});
      setNotice('Spotkanie zostało utworzone.');
      setCreating(false);
      setForm((current)=>({...current,title:'',description:'',startsAt:localInputValue(),pointIds:[],userIds:[]}));
      await load(true);
    }catch(e){setError(e instanceof Error?e.message:'Nie udało się utworzyć spotkania.');}
    finally{setBusyId(null);}
  };

  const act=async(item:MeetingSummary,action:'register'|'unregister'|'start'|'end'|'cancel')=>{
    setBusyId(item.id+':'+action);setError('');setNotice('');
    try{
      await window.lockOn.meetings[action](item.id);
      setNotice(action==='register'?'Jesteś zapisany na spotkanie.':
        action==='unregister'?'Zapis został anulowany.':
        action==='start'?'Spotkanie zostało rozpoczęte.':
        action==='end'?'Spotkanie zostało zakończone.':'Spotkanie zostało anulowane.');
      await load(true);
      if(action==='start')setActiveMeetingId(item.id);
      if(action==='end'||action==='cancel')setActiveMeetingId((current)=>current===item.id?null:current);
    }catch(e){setError(e instanceof Error?e.message:'Nie udało się wykonać akcji spotkania.');}
    finally{setBusyId(null);}
  };

  return <section className="meeting-center" aria-label="Spotkania pracowników">
    <div className="meeting-center-heading">
      <div>
        <span className="eyebrow"><UsersRound size={13}/> SPOTKANIA PRACOWNIKÓW</span>
        <h2>Nadchodzące spotkania</h2>
        <p>Zapisz się wcześniej. Gdy prowadzący rozpocznie spotkanie, pokój pojawi się tutaj automatycznie.</p>
      </div>
      <div className="meeting-center-heading-actions">
        <button className="button small secondary" disabled={loading} onClick={()=>void load()}><RefreshCw className={loading?'spin':''} size={14}/> Odśwież</button>
        {canHost&&<button className="button small primary" onClick={()=>void openCreate()}><Plus size={14}/> Utwórz spotkanie</button>}
      </div>
    </div>

    {notice&&<div className="meeting-notice success"><CheckCircle2 size={14}/>{notice}</div>}
    {error&&<div className="meeting-notice error"><XCircle size={14}/>{error}</div>}

    {primary ? <article className={'meeting-primary-card '+(primary.status==='LIVE'?'live':'')}>
      <div className="meeting-primary-status">
        {primary.status==='LIVE'?<Radio size={16}/>:<CalendarClock size={16}/>}
        <span>{statusLabel(primary.status)}</span>
      </div>
      <div className="meeting-primary-copy">
        <strong>{primary.title}</strong>
        {primary.description&&<p>{primary.description}</p>}
        <div className="meeting-meta">
          <span><CalendarClock size={13}/>{dateLabel(primary.startsAt)}</span>
          <span><Clock3 size={13}/>{primary.expectedDurationMinutes} min</span>
          <span><UsersRound size={13}/>{primary.registeredCount}/{primary.maxParticipants}</span>
          <span>{audienceLabel(primary.audienceType)}</span>
        </div>
        <small>Prowadzący: {primary.hostName}</small>
      </div>
      <div className="meeting-primary-actions">
        {!primary.canHost&&primary.status==='SCHEDULED'&&(
          primary.registered
            ? <button className="button secondary" disabled={Boolean(busyId)} onClick={()=>void act(primary,'unregister')}><UserMinus size={14}/> Wypisz się</button>
            : <button className="button primary" disabled={Boolean(busyId)} onClick={()=>void act(primary,'register')}><UserPlus size={14}/> Zapisz się</button>
        )}
        {primary.canHost&&primary.status==='SCHEDULED'&&<button className="button primary" disabled={Boolean(busyId)} onClick={()=>void act(primary,'start')}><Radio size={14}/> Rozpocznij</button>}
        {primary.status==='LIVE'&&(primary.canHost||primary.registered)&&<button className="button primary" disabled={Boolean(busyId)} onClick={()=>setActiveMeetingId(primary.id)}><Radio size={14}/> Wejdź do pokoju</button>}
        {primary.status==='LIVE'&&!primary.canHost&&!primary.registered&&<button className="button primary" disabled={Boolean(busyId)} onClick={()=>void act(primary,'register')}><UserPlus size={14}/> Zapisz się, aby dołączyć</button>}
        {primary.canHost&&primary.status==='LIVE'&&<button className="button danger-soft" disabled={Boolean(busyId)} onClick={()=>void act(primary,'end')}><Square size={14}/> Zakończ</button>}
        {primary.canHost&&primary.status==='SCHEDULED'&&<button className="button secondary" disabled={Boolean(busyId)} onClick={()=>void act(primary,'cancel')}><XCircle size={14}/> Anuluj</button>}
      </div>
    </article> : <div className="meeting-empty">
      <CalendarClock size={24}/>
      <div><strong>Brak zaplanowanych spotkań.</strong><span>{canHost?'Możesz utworzyć pierwsze spotkanie dla zespołu.':'Gdy OWNER lub BOSS zaplanuje spotkanie dla Twojej grupy, zobaczysz je tutaj.'}</span></div>
    </div>}

    {later.length>0&&<div className="meeting-later-list">
      {later.map((item)=><article key={item.id}>
        <div><strong>{item.title}</strong><small>{dateLabel(item.startsAt)} · {item.hostName}</small></div>
        <span>{item.registeredCount}/{item.maxParticipants}</span>
        {!item.canHost&&item.status==='SCHEDULED'&&(item.registered
          ? <button className="button tiny secondary" disabled={Boolean(busyId)} onClick={()=>void act(item,'unregister')}>Wypisz</button>
          : <button className="button tiny secondary" disabled={Boolean(busyId)} onClick={()=>void act(item,'register')}>Zapisz</button>)}
        {item.canHost&&item.status==='SCHEDULED'&&<button className="button tiny secondary" disabled={Boolean(busyId)} onClick={()=>void act(item,'start')}>Start</button>}
        {item.status==='LIVE'&&(item.canHost||item.registered)&&<button className="button tiny primary" disabled={Boolean(busyId)} onClick={()=>setActiveMeetingId(item.id)}>Dołącz</button>}
      </article>)}
    </div>}

    {activeMeeting&&activeMeeting.status==='LIVE'&&<MeetingRoom meeting={activeMeeting} currentUserId={currentUserId} onClose={()=>setActiveMeetingId(null)}/>}
    {creating&&canHost&&<div className="meeting-create-backdrop" role="presentation">
      <section className="meeting-create-dialog" role="dialog" aria-modal="true" aria-labelledby="meeting-create-title">
        <div className="meeting-create-head">
          <div><span className="eyebrow"><Plus size={13}/> NOWE SPOTKANIE</span><h2 id="meeting-create-title">Zaplanuj spotkanie</h2><p>Ustaw termin, grupę uczestników i zasady audio/udostępniania ekranu.</p></div>
          <button className="button tiny secondary" onClick={()=>setCreating(false)}>Zamknij</button>
        </div>
        <div className="meeting-create-grid">
          <label className="wide"><span>Tytuł</span><input maxLength={160} value={form.title} onChange={(e)=>patch('title',e.target.value)} placeholder="Np. szkolenie ServiceOS"/></label>
          <label className="wide"><span>Opis</span><textarea rows={3} maxLength={3000} value={form.description??''} onChange={(e)=>patch('description',e.target.value)} placeholder="Krótki cel i agenda spotkania"/></label>
          <label><span>Termin</span><input type="datetime-local" value={form.startsAt} onChange={(e)=>patch('startsAt',e.target.value)}/></label>
          <label><span>Czas</span><input type="number" min={5} max={720} value={form.expectedDurationMinutes} onChange={(e)=>patch('expectedDurationMinutes',Number(e.target.value)||60)}/></label>
          <label><span>Limit osób</span><input type="number" min={2} max={500} value={form.maxParticipants} onChange={(e)=>patch('maxParticipants',Number(e.target.value)||50)}/></label>
          <label><span>Zaproszeni</span><select value={form.audienceType} onChange={(e)=>patch('audienceType',e.target.value as MeetingAudienceType)}>
            <option value="ALL">Wszyscy pracownicy</option>
            <option value="POINTS">Wybrane punkty</option>
            <option value="USERS">Wybrane osoby</option>
          </select></label>
        </div>

        {form.audienceType==='POINTS'&&<div className="meeting-audience-picker">
          <strong>Wybierz punkty</strong>
          <div>{(options?.points??[]).map((point)=><label key={point.id}><input type="checkbox" checked={(form.pointIds??[]).includes(point.id)} onChange={()=>togglePoint(point.id)}/><span>{point.name}<small>{point.city}</small></span></label>)}</div>
        </div>}
        {form.audienceType==='USERS'&&<div className="meeting-audience-picker">
          <strong>Wybierz osoby</strong>
          <div>{(options?.users??[]).filter((user)=>user.id!==currentUserId).map((user)=><label key={user.id}><input type="checkbox" checked={(form.userIds??[]).includes(user.id)} onChange={()=>toggleUser(user.id)}/><span>{user.name}<small>{user.role||'pracownik'}{user.email?' · '+user.email:''}</small></span></label>)}</div>
        </div>}

        <div className="meeting-permissions">
          <label><input type="checkbox" checked={form.allowParticipantAudio} onChange={(e)=>patch('allowParticipantAudio',e.target.checked)}/><Mic size={15}/><span><strong>Uczestnicy mogą mówić</strong><small>Domyślnie mikrofon po wejściu pozostanie wyciszony.</small></span></label>
          <label><input type="checkbox" checked={form.allowParticipantScreenShare} onChange={(e)=>patch('allowParticipantScreenShare',e.target.checked)}/><MonitorUp size={15}/><span><strong>Uczestnicy mogą udostępniać ekran</strong><small>Prowadzący zawsze będzie mógł udostępnić swój ekran.</small></span></label>
        </div>

        <div className="meeting-create-actions">
          <button className="button secondary" onClick={()=>setCreating(false)}>Anuluj</button>
          <button className="button primary" disabled={busyId==='create'} onClick={()=>void createMeeting()}>{busyId==='create'?'Tworzę…':'Utwórz spotkanie'}</button>
        </div>
      </section>
    </div>}
  </section>;
}
