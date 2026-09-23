import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Clock3, Mic2, MonitorUp, Plus, Radio, UserRound, UsersRound, X } from 'lucide-react';
import type { MeetingAttendanceItem, MeetingOptions, MeetingSummary, UserRole } from '../types/electron';
import { MeetingRoom } from './MeetingRoom';

const statusLabel: Record<MeetingSummary['status'], string> = {
  SCHEDULED: 'Zaplanowane',
  LIVE: 'Trwa teraz',
  ENDED: 'Zakończone',
  CANCELLED: 'Anulowane'
};

const formatWhen = (value: string) =>
  new Date(value).toLocaleString('pl-PL', { dateStyle:'medium', timeStyle:'short' });

const meetingCountdown = (startsAt: string) => {
  const diff = new Date(startsAt).getTime() - Date.now();
  if (diff <= 0) return 'Spotkanie powinno się zaraz rozpocząć';
  const minutes = Math.ceil(diff / 60_000);
  if (minutes < 60) return 'Spotkanie rozpocznie się za ' + minutes + ' min';
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return 'Spotkanie rozpocznie się za ' + hours + ' godz.';
  const days = Math.ceil(hours / 24);
  return 'Spotkanie rozpocznie się za ' + days + (days === 1 ? ' dzień' : ' dni');
};

const toLocalDateTimeInput = (date = new Date(Date.now() + 60 * 60_000)) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0,16);
};

export function MeetingsCard({ role }: { role: UserRole }) {
  const canCreate = role === 'OWNER' || role === 'BOSS';
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [options, setOptions] = useState<MeetingOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [activeRoom, setActiveRoom] = useState<MeetingSummary | null>(null);
  const [attendanceMeeting, setAttendanceMeeting] = useState<MeetingSummary | null>(null);
  const [attendanceItems, setAttendanceItems] = useState<MeetingAttendanceItem[]>([]);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [rescheduleId, setRescheduleId] = useState('');
  const [rescheduleValue, setRescheduleValue] = useState('');
  const [form, setForm] = useState({
    title:'',
    description:'',
    startsAt:toLocalDateTimeInput(),
    plannedMinutes:60,
    maxParticipants:50,
    audienceType:'ALL' as 'ALL'|'POINT'|'USER',
    targetIds:[] as string[],
    allowParticipantAudio:true,
    allowParticipantScreenShare:false
  });

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const payload = await window.lockOn.meetings.list();
      setMeetings(payload.meetings ?? []);
      setError('');
    } catch (err) {
      if (!silent) setError(err instanceof Error ? err.message : 'Nie udało się pobrać spotkań.');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    if (canCreate) void window.lockOn.meetings.options().then(setOptions).catch(() => undefined);
    const timer = window.setInterval(() => void load(true), 15_000);
    return () => window.clearInterval(timer);
  }, [canCreate]);

  const visible = useMemo(
    () => meetings.filter((item) => item.status !== 'CANCELLED').slice(0,6),
    [meetings]
  );

  const perform = async (meetingId: string, action: 'register'|'unregister'|'start'|'end'|'cancel') => {
    setBusyId(meetingId + ':' + action);
    setError('');
    try {
      await window.lockOn.meetings.action(meetingId, action);
      await load(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się wykonać akcji spotkania.');
    } finally {
      setBusyId('');
    }
  };

  const openAttendance = async (meeting: MeetingSummary) => {
    setBusyId(meeting.id+':attendance');
    setError('');
    try {
      const data = await window.lockOn.meetings.attendance(meeting.id);
      setAttendanceItems(data.attendance ?? []);
      setAttendanceMeeting(meeting);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się pobrać frekwencji.');
    } finally {
      setBusyId('');
    }
  };

  const beginReschedule = (meeting: MeetingSummary) => {
    setRescheduleId(meeting.id);
    setRescheduleValue(toLocalDateTimeInput(new Date(meeting.startsAt)));
    setError('');
  };

  const saveReschedule = async (meetingId: string) => {
    const next = new Date(rescheduleValue);
    if (!rescheduleValue || Number.isNaN(next.getTime())) {
      setError('Wybierz prawidłowy nowy termin spotkania.');
      return;
    }
    setBusyId(meetingId+':reschedule');
    setError('');
    try {
      await window.lockOn.meetings.update(meetingId,{startsAt:next.toISOString()});
      setRescheduleId('');
      setRescheduleValue('');
      await load(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się zmienić terminu spotkania.');
    } finally {
      setBusyId('');
    }
  };

  const createMeeting = async () => {
    const title = form.title.trim();
    if (title.length < 3) {
      setError('Wpisz tytuł spotkania.');
      return;
    }
    if (form.audienceType !== 'ALL' && form.targetIds.length === 0) {
      setError(form.audienceType === 'POINT' ? 'Wybierz co najmniej jeden punkt.' : 'Wybierz co najmniej jedną osobę.');
      return;
    }
    const startsAt = new Date(form.startsAt);
    if (!form.startsAt || Number.isNaN(startsAt.getTime())) {
      setError('Wybierz prawidłowy termin spotkania.');
      return;
    }
    setBusyId('create');
    setError('');
    try {
      await window.lockOn.meetings.create({
        title,
        description:form.description.trim(),
        startsAt:startsAt.toISOString(),
        plannedMinutes:Number(form.plannedMinutes),
        maxParticipants:Number(form.maxParticipants),
        allowParticipantAudio:form.allowParticipantAudio,
        allowParticipantScreenShare:form.allowParticipantScreenShare,
        audience:form.audienceType === 'ALL'
          ? [{ type:'ALL' }]
          : form.audienceType === 'POINT'
            ? form.targetIds.map((pointId)=>({ type:'POINT' as const, pointId }))
            : form.targetIds.map((userId)=>({ type:'USER' as const, userId }))
      });
      setForm((current) => ({ ...current, title:'', description:'', startsAt:toLocalDateTimeInput(), targetIds:[] }));
      setCreateOpen(false);
      await load(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się utworzyć spotkania.');
    } finally {
      setBusyId('');
    }
  };

  return (
    <section className="meetings-card">
      <div className="meetings-card-heading">
        <div>
          <span className="meetings-eyebrow"><Radio size={13} /> Spotkania i szkolenia</span>
          <h2>Najbliższe spotkania</h2>
          <p>Zapisuj się na szkolenia, odprawy i webinary bez wychodzenia z ServiceOS.</p>
        </div>
        {canCreate && (
          <button className="button secondary small" onClick={() => setCreateOpen((value) => !value)}>
            {createOpen ? <X size={14}/> : <Plus size={14}/>} {createOpen ? 'Zamknij' : 'Zaplanuj spotkanie'}
          </button>
        )}
      </div>

      {createOpen && canCreate && (
        <div className="meeting-create-panel">
          <div className="meeting-create-grid">
            <label><span>Tytuł</span><input value={form.title} maxLength={120} onChange={(e)=>setForm({...form,title:e.target.value})} placeholder="Np. szkolenie z przyjęcia urządzeń" /></label>
            <label><span>Termin</span><input type="datetime-local" value={form.startsAt} onChange={(e)=>setForm({...form,startsAt:e.target.value})} /></label>
            <label><span>Czas (min)</span><input type="number" min={10} max={480} value={form.plannedMinutes} onChange={(e)=>setForm({...form,plannedMinutes:Number(e.target.value)})} /></label>
            <label><span>Limit osób</span><input type="number" min={2} max={500} value={form.maxParticipants} onChange={(e)=>setForm({...form,maxParticipants:Number(e.target.value)})} /></label>
            <label><span>Dla kogo</span><select value={form.audienceType} onChange={(e)=>setForm({...form,audienceType:e.target.value as 'ALL'|'POINT'|'USER',targetIds:[]})}><option value="ALL">Wszyscy</option><option value="POINT">Wybrane punkty</option><option value="USER">Wybrane osoby</option></select></label>
            {form.audienceType === 'POINT' && <div className="meeting-audience-picker"><span>Punkty ({form.targetIds.length})</span><div>{options?.points.map((item)=><label key={item.id}><input type="checkbox" checked={form.targetIds.includes(item.id)} onChange={()=>setForm((current)=>({...current,targetIds:current.targetIds.includes(item.id)?current.targetIds.filter((id)=>id!==item.id):[...current.targetIds,item.id]}))}/><span><strong>{item.name}</strong><small>{item.city}</small></span></label>)}</div></div>}
            {form.audienceType === 'USER' && <div className="meeting-audience-picker"><span>Osoby ({form.targetIds.length})</span><div>{options?.users.map((item)=><label key={item.id}><input type="checkbox" checked={form.targetIds.includes(item.id)} onChange={()=>setForm((current)=>({...current,targetIds:current.targetIds.includes(item.id)?current.targetIds.filter((id)=>id!==item.id):[...current.targetIds,item.id]}))}/><span><strong>{item.name}</strong><small>{item.email || item.role}</small></span></label>)}</div></div>}
            <label className="meeting-create-description"><span>Opis</span><textarea rows={3} maxLength={2000} value={form.description} onChange={(e)=>setForm({...form,description:e.target.value})} placeholder="Krótko opisz temat spotkania." /></label>
          </div>
          <div className="meeting-create-flags">
            <label><input type="checkbox" checked={form.allowParticipantAudio} onChange={(e)=>setForm({...form,allowParticipantAudio:e.target.checked})}/><Mic2 size={14}/> Uczestnicy mogą używać mikrofonu</label>
            <label><input type="checkbox" checked={form.allowParticipantScreenShare} onChange={(e)=>setForm({...form,allowParticipantScreenShare:e.target.checked})}/><MonitorUp size={14}/> Uczestnicy mogą udostępniać ekran</label>
          </div>
          <button className="button primary" disabled={busyId==='create'} onClick={()=>void createMeeting()}><CalendarDays size={15}/> Zapisz spotkanie</button>
        </div>
      )}

      {error && <div className="meeting-error">{error}</div>}
      {loading ? <div className="meeting-empty">Pobieram terminarz…</div> : visible.length === 0 ? (
        <div className="meeting-empty">Nie masz teraz żadnych zaplanowanych spotkań.</div>
      ) : (
        <div className="meeting-list">
          {visible.map((meeting) => {
            const full = meeting.registeredCount >= meeting.maxParticipants && !meeting.registeredByMe;
            return (
              <article className={'meeting-row meeting-row-'+meeting.status.toLowerCase()} key={meeting.id}>
                <div className="meeting-date-box"><CalendarDays size={18}/><strong>{new Date(meeting.startsAt).toLocaleDateString('pl-PL',{day:'2-digit',month:'2-digit'})}</strong><span>{new Date(meeting.startsAt).toLocaleTimeString('pl-PL',{hour:'2-digit',minute:'2-digit'})}</span></div>
                <div className="meeting-main">
                  <div className="meeting-title-line"><strong>{meeting.title}</strong><span>{statusLabel[meeting.status]}</span></div>
                  {meeting.description && <p>{meeting.description}</p>}
                  <div className="meeting-meta">
                    <span><Clock3 size={13}/> {meeting.plannedMinutes} min</span>
                    <span><UsersRound size={13}/> {meeting.registeredCount}/{meeting.maxParticipants}</span>
                    <span><UserRound size={13}/> {meeting.hostName}</span>
                    {meeting.allowParticipantAudio && <span><Mic2 size={13}/> audio</span>}
                    {meeting.allowParticipantScreenShare && <span><MonitorUp size={13}/> ekran</span>}
                  </div>
                  <small>{meeting.status==='SCHEDULED' ? meetingCountdown(meeting.startsAt)+' · ' : ''}{formatWhen(meeting.startsAt)}</small>
                </div>
                <div className="meeting-actions">
                  {meeting.status === 'SCHEDULED' && !meeting.canManage && (
                    meeting.registeredByMe
                      ? <><span className="meeting-registered-note">Jesteś zapisany ✓</span><button className="button secondary small" disabled={Boolean(busyId)} onClick={()=>void perform(meeting.id,'unregister')}>Wypisz mnie</button></>
                      : <button className="button primary small" disabled={Boolean(busyId)||full} onClick={()=>void perform(meeting.id,'register')}>{full?'Brak miejsc':'Zapisz mnie'}</button>
                  )}
                  {meeting.canManage && meeting.status === 'SCHEDULED' && <>
                    <button className="button secondary small" disabled={Boolean(busyId)} onClick={()=>beginReschedule(meeting)}>Zmień termin</button>
                    <button className="button primary small" disabled={Boolean(busyId)} onClick={()=>void perform(meeting.id,'start')}>Rozpocznij</button>
                    <button className="button secondary small" disabled={Boolean(busyId)} onClick={()=>void perform(meeting.id,'cancel')}>Anuluj</button>
                  </>}
                  {meeting.status === 'LIVE' && (meeting.canManage || meeting.registeredByMe) && <button className="button primary small" disabled={Boolean(busyId)} onClick={()=>setActiveRoom(meeting)}>Dołącz</button>}
                  {meeting.canManage && meeting.status === 'LIVE' && <button className="button secondary small" disabled={Boolean(busyId)} onClick={()=>void perform(meeting.id,'end')}>Zakończ</button>}
                  {!meeting.canManage && meeting.status === 'LIVE' && !meeting.registeredByMe && <span className="meeting-live-note">Zapisz się przed dołączeniem</span>}
                  {meeting.canManage && meeting.status === 'ENDED' && <button className="button secondary small" disabled={Boolean(busyId)} onClick={()=>void openAttendance(meeting)}>Frekwencja</button>}
                </div>
                {rescheduleId===meeting.id && meeting.status==='SCHEDULED' && meeting.canManage && (
                  <div className="meeting-reschedule-editor">
                    <input type="datetime-local" value={rescheduleValue} onChange={(e)=>setRescheduleValue(e.target.value)} />
                    <button className="button primary small" disabled={Boolean(busyId)} onClick={()=>void saveReschedule(meeting.id)}>Zapisz termin</button>
                    <button className="button secondary small" disabled={Boolean(busyId)} onClick={()=>{setRescheduleId('');setRescheduleValue('');}}>Anuluj zmianę</button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
      {activeRoom && <MeetingRoom meeting={activeRoom} onClose={()=>setActiveRoom(null)} />}
      {attendanceMeeting && (
        <div className="meeting-attendance-backdrop" role="dialog" aria-modal="true">
          <div className="meeting-attendance-modal">
            <div className="meeting-source-picker-head">
              <div><strong>Frekwencja — {attendanceMeeting.title}</strong><span>Zapisani i rzeczywista obecność na spotkaniu.</span></div>
              <button className="icon-button" onClick={()=>setAttendanceMeeting(null)}><X size={17}/></button>
            </div>
            <div className="meeting-attendance-list">
              {attendanceItems.length===0 ? <div className="meeting-empty">Nikt nie był zapisany na to spotkanie.</div> : attendanceItems.map((item)=>(
                <div className="meeting-attendance-row" key={item.userId}>
                  <div><strong>{item.name}</strong><small>{item.registrationStatus==='REGISTERED'?'Zapisany':item.registrationStatus==='CANCELLED'?'Wypisany':'Prowadzący / bez zapisu'}</small></div>
                  <span>{item.joined?'Dołączył':'Nie dołączył'}</span>
                  <span>{item.firstJoinedAt?new Date(item.firstJoinedAt).toLocaleString('pl-PL'):'—'}</span>
                  <span>{item.lastLeftAt?new Date(item.lastLeftAt).toLocaleString('pl-PL'):'—'}</span>
                  <span>{item.totalSeconds?Math.max(1,Math.round(item.totalSeconds/60))+' min':'—'}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
