import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Clock3, Mic2, MonitorUp, Plus, Radio, UserRound, UsersRound, X } from 'lucide-react';
import type { MeetingOptions, MeetingSummary, UserRole } from '../types/electron';
import { MeetingRoom } from './MeetingRoom';

const statusLabel: Record<MeetingSummary['status'], string> = {
  SCHEDULED: 'Zaplanowane',
  LIVE: 'Trwa teraz',
  ENDED: 'Zakończone',
  CANCELLED: 'Anulowane'
};

const formatWhen = (value: string) =>
  new Date(value).toLocaleString('pl-PL', { dateStyle:'medium', timeStyle:'short' });

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
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    title:'',
    description:'',
    startsAt:toLocalDateTimeInput(),
    plannedMinutes:60,
    maxParticipants:50,
    audienceType:'ALL' as 'ALL'|'POINT'|'USER',
    targetId:'',
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

  const createMeeting = async () => {
    const title = form.title.trim();
    if (title.length < 3) {
      setError('Wpisz tytuł spotkania.');
      return;
    }
    if (form.audienceType !== 'ALL' && !form.targetId) {
      setError(form.audienceType === 'POINT' ? 'Wybierz punkt.' : 'Wybierz osobę.');
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
        audience:[form.audienceType === 'ALL'
          ? { type:'ALL' }
          : form.audienceType === 'POINT'
            ? { type:'POINT', pointId:form.targetId }
            : { type:'USER', userId:form.targetId }]
      });
      setForm((current) => ({ ...current, title:'', description:'', startsAt:toLocalDateTimeInput(), targetId:'' }));
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
            {createOpen ? <X size={14}/> : <Plus size={14}/>} {createOpen ? 'Zamknij' : 'Nowe spotkanie'}
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
            <label><span>Dla kogo</span><select value={form.audienceType} onChange={(e)=>setForm({...form,audienceType:e.target.value as 'ALL'|'POINT'|'USER',targetId:''})}><option value="ALL">Wszyscy</option><option value="POINT">Konkretny punkt</option><option value="USER">Konkretna osoba</option></select></label>
            {form.audienceType === 'POINT' && <label><span>Punkt</span><select value={form.targetId} onChange={(e)=>setForm({...form,targetId:e.target.value})}><option value="">Wybierz punkt…</option>{options?.points.map((item)=><option key={item.id} value={item.id}>{item.name} — {item.city}</option>)}</select></label>}
            {form.audienceType === 'USER' && <label><span>Osoba</span><select value={form.targetId} onChange={(e)=>setForm({...form,targetId:e.target.value})}><option value="">Wybierz osobę…</option>{options?.users.map((item)=><option key={item.id} value={item.id}>{item.name}{item.email ? ' · '+item.email : ''}</option>)}</select></label>}
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
                  <small>{formatWhen(meeting.startsAt)}</small>
                </div>
                <div className="meeting-actions">
                  {meeting.status === 'SCHEDULED' && !meeting.canManage && (
                    meeting.registeredByMe
                      ? <button className="button secondary small" disabled={Boolean(busyId)} onClick={()=>void perform(meeting.id,'unregister')}>Wypisz mnie</button>
                      : <button className="button primary small" disabled={Boolean(busyId)||full} onClick={()=>void perform(meeting.id,'register')}>{full?'Brak miejsc':'Zapisz mnie'}</button>
                  )}
                  {meeting.canManage && meeting.status === 'SCHEDULED' && <><button className="button primary small" disabled={Boolean(busyId)} onClick={()=>void perform(meeting.id,'start')}>Rozpocznij</button><button className="button secondary small" disabled={Boolean(busyId)} onClick={()=>void perform(meeting.id,'cancel')}>Anuluj</button></>}
                  {meeting.status === 'LIVE' && (meeting.canManage || meeting.registeredByMe) && <button className="button primary small" disabled={Boolean(busyId)} onClick={()=>setActiveRoom(meeting)}>Dołącz</button>}
                  {meeting.canManage && meeting.status === 'LIVE' && <button className="button secondary small" disabled={Boolean(busyId)} onClick={()=>void perform(meeting.id,'end')}>Zakończ</button>}
                  {!meeting.canManage && meeting.status === 'LIVE' && !meeting.registeredByMe && <span className="meeting-live-note">Zapisz się przed dołączeniem</span>}
                </div>
              </article>
            );
          })}
        </div>
      )}
      {activeRoom && <MeetingRoom meeting={activeRoom} onClose={()=>setActiveRoom(null)} />}
    </section>
  );
}
