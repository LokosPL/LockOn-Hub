import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CalendarDays, Clock3, Mic2, MonitorUp, Plus, Radio, UserRound, UsersRound } from 'lucide-react';
import type { MeetingAttendanceItem, MeetingOptions, MeetingSummary, UserRole } from '../types/electron';
import { MeetingRoom } from './MeetingRoom';
import { useAppDialog } from './AppDialog';

type AudienceType = 'ALL'|'POINT'|'USER';
type MeetingFormState = {
  title:string;
  description:string;
  startsAt:string;
  plannedMinutes:number;
  maxParticipants:number;
  audienceType:AudienceType;
  targetIds:string[];
  allowParticipantAudio:boolean;
  allowParticipantScreenShare:boolean;
  emailNotificationsEnabled:boolean;
};

const statusLabel: Record<MeetingSummary['status'], string> = {
  SCHEDULED: 'Zaplanowane',
  LIVE: '● TRWA TERAZ',
  ENDED: 'Zakończone',
  CANCELLED: 'Anulowane'
};

const formatWhen = (value: string) =>
  new Date(value).toLocaleString('pl-PL', { dateStyle:'medium', timeStyle:'short' });

const meetingScheduleHint = (startsAt: string) => {
  const start = new Date(startsAt);
  const startsMs = start.getTime();
  if (!Number.isFinite(startsMs)) return '';
  const now = new Date();
  const diff = startsMs - now.getTime();
  if (diff <= 0) return 'Termin minął · oczekiwanie na prowadzącego';
  const minutes = Math.ceil(diff / 60_000);
  if (minutes <= 60) return 'Za ' + minutes + ' min';
  if (
    start.getFullYear() === now.getFullYear() &&
    start.getMonth() === now.getMonth() &&
    start.getDate() === now.getDate()
  ) return 'Dzisiaj ' + start.toLocaleTimeString('pl-PL',{hour:'2-digit',minute:'2-digit'});
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return 'Za ' + hours + ' godz.';
  return formatWhen(startsAt);
};

const toLocalDateTimeInput = (date = new Date(Date.now() + 60 * 60_000)) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0,16);
};

const blankForm = (): MeetingFormState => ({
  title:'',
  description:'',
  startsAt:toLocalDateTimeInput(),
  plannedMinutes:60,
  maxParticipants:50,
  audienceType:'ALL',
  targetIds:[],
  allowParticipantAudio:true,
  allowParticipantScreenShare:false,
  emailNotificationsEnabled:false
});

const formForMeeting = (meeting: MeetingSummary): MeetingFormState => {
  const pointIds=meeting.audience.filter((item)=>item.type==='POINT'&&item.pointId).map((item)=>item.pointId as string);
  const userIds=meeting.audience.filter((item)=>item.type==='USER'&&item.userId).map((item)=>item.userId as string);
  const audienceType:AudienceType = meeting.audience.some((item)=>item.type==='ALL') ? 'ALL' : pointIds.length ? 'POINT' : 'USER';
  return {
    title:meeting.title,
    description:meeting.description,
    startsAt:toLocalDateTimeInput(new Date(meeting.startsAt)),
    plannedMinutes:meeting.plannedMinutes,
    maxParticipants:meeting.maxParticipants,
    audienceType,
    targetIds:audienceType==='POINT'?pointIds:audienceType==='USER'?userIds:[],
    allowParticipantAudio:meeting.allowParticipantAudio,
    allowParticipantScreenShare:meeting.allowParticipantScreenShare,
    emailNotificationsEnabled:meeting.emailNotificationsEnabled
  };
};

const payloadFromForm = (form: MeetingFormState) => {
  const startsAt = new Date(form.startsAt);
  if (!form.startsAt || Number.isNaN(startsAt.getTime())) throw new Error('Wybierz prawidłowy termin spotkania.');
  const title=form.title.trim();
  if(title.length<3)throw new Error('Wpisz tytuł spotkania.');
  if(form.audienceType!=='ALL'&&form.targetIds.length===0)throw new Error(form.audienceType==='POINT'?'Wybierz co najmniej jeden punkt.':'Wybierz co najmniej jedną osobę.');
  return {
    title,
    description:form.description.trim(),
    startsAt:startsAt.toISOString(),
    plannedMinutes:Number(form.plannedMinutes),
    maxParticipants:Number(form.maxParticipants),
    allowParticipantAudio:form.allowParticipantAudio,
    allowParticipantScreenShare:form.allowParticipantScreenShare,
    emailNotificationsEnabled:form.emailNotificationsEnabled,
    audience:form.audienceType==='ALL'
      ? [{type:'ALL' as const}]
      : form.audienceType==='POINT'
        ? form.targetIds.map((pointId)=>({type:'POINT' as const,pointId}))
        : form.targetIds.map((userId)=>({type:'USER' as const,userId}))
  };
};

export function MeetingsCard({ role }: { role: UserRole }) {
  const { confirm } = useAppDialog();
  const canCreate = role === 'OWNER' || role === 'BOSS' || role === 'COORDINATOR';
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
  const [editId, setEditId] = useState('');
  const [form, setForm] = useState<MeetingFormState>(blankForm());
  const [editForm, setEditForm] = useState<MeetingFormState>(blankForm());

  const resetPanel = () => {
    setActiveRoom(null);
    setAttendanceMeeting(null);
    setAttendanceItems([]);
    setCreateOpen(false);
    setRescheduleId('');
    setRescheduleValue('');
    setEditId('');
    setError('');
  };

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const payload = await window.lockOn.meetings.list();
      setMeetings(payload.meetings ?? []);
      setError('');
      return payload.meetings ?? [];
    } catch (err) {
      if (!silent) setError(err instanceof Error ? err.message : 'Nie udało się pobrać spotkań.');
      return [];
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
    () => meetings
      .filter((item) => item.status === 'LIVE' || item.status === 'SCHEDULED')
      .sort((a,b) => a.status===b.status
        ? new Date(a.startsAt).getTime()-new Date(b.startsAt).getTime()
        : a.status==='LIVE' ? -1 : 1)
      .slice(0,6),
    [meetings]
  );

  const history = useMemo(
    () => meetings
      .filter((item)=>item.status==='ENDED'||item.status==='CANCELLED')
      .sort((a,b)=>new Date(b.updatedAt).getTime()-new Date(a.updatedAt).getTime())
      .slice(0,6),
    [meetings]
  );

  const editedMeeting = editId ? meetings.find((item)=>item.id===editId) ?? null : null;
  const rescheduledMeeting = rescheduleId ? meetings.find((item)=>item.id===rescheduleId) ?? null : null;

  const perform = async (meetingId: string, action: 'register'|'unregister'|'start'|'end'|'cancel') => {
    setBusyId(meetingId + ':' + action);
    setError('');
    try {
      const result = await window.lockOn.meetings.action(meetingId, action);
      const refreshed = await load(true);
      if (action === 'start') {
        const liveMeeting = result.meeting?.status === 'LIVE'
          ? result.meeting
          : refreshed.find((item)=>item.id===meetingId && item.status==='LIVE') ?? null;
        if (liveMeeting) setActiveRoom(liveMeeting);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się wykonać akcji spotkania.');
    } finally {
      setBusyId('');
    }
  };

  const confirmManagedAction = async (meeting: MeetingSummary, action: 'end'|'cancel') => {
    const ending = action === 'end';
    const accepted = await confirm({
      title:ending ? 'Zakończyć spotkanie?' : 'Anulować spotkanie?',
      message:ending
        ? 'Po zakończeniu uczestnicy nie będą mogli ponownie dołączyć.'
        : 'Spotkanie zostanie oznaczone jako anulowane i nie będzie można go uruchomić.',
      detail:ending
        ? 'Aktywna frekwencja zostanie domknięta, a pokój LiveKit zostanie zamknięty.'
        : 'Uczestnicy zobaczą status „Anulowane”.',
      confirmLabel:ending ? 'Zakończ spotkanie' : 'Anuluj spotkanie',
      cancelLabel:'Wróć',
      tone:'warning'
    });
    if (accepted) await perform(meeting.id,action);
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
    setCreateOpen(false);
    setEditId('');
    setAttendanceMeeting(null);
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

  const beginEdit = (meeting: MeetingSummary) => {
    setCreateOpen(false);
    setRescheduleId('');
    setAttendanceMeeting(null);
    setEditId(meeting.id);
    setEditForm(formForMeeting(meeting));
    setError('');
  };

  const saveEdit = async (meetingId: string) => {
    setBusyId(meetingId+':edit');
    setError('');
    try {
      await window.lockOn.meetings.update(meetingId,payloadFromForm(editForm));
      setEditId('');
      await load(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się zapisać zmian spotkania.');
    } finally {
      setBusyId('');
    }
  };

  const createMeeting = async () => {
    setBusyId('create');
    setError('');
    try {
      await window.lockOn.meetings.create(payloadFromForm(form));
      setForm(blankForm());
      setCreateOpen(false);
      await load(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się utworzyć spotkania.');
    } finally {
      setBusyId('');
    }
  };

  const openCreate = () => {
    setEditId('');
    setRescheduleId('');
    setAttendanceMeeting(null);
    setForm(blankForm());
    setCreateOpen(true);
    setError('');
  };

  const renderPanelHeading = (title:string, description:string) => (
    <div className="meeting-workspace-heading">
      <button className="button secondary small" onClick={resetPanel}><ArrowLeft size={14}/> Wróć do spotkań</button>
      <div>
        <span className="meetings-eyebrow"><Radio size={13}/> Spotkania i szkolenia</span>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </div>
  );

  const renderEditor = (
    value:MeetingFormState,
    setValue:(next:MeetingFormState)=>void,
    submitLabel:string,
    onSubmit:()=>void,
    busyKey:string
  ) => (
    <div className="meeting-create-panel meeting-edit-panel">
      <div className="meeting-create-grid">
        <label><span>Tytuł</span><input value={value.title} maxLength={120} onChange={(e)=>setValue({...value,title:e.target.value})} placeholder="Np. szkolenie z przyjęcia urządzeń" /></label>
        <label><span>Data i godzina</span><input type="datetime-local" value={value.startsAt} onChange={(e)=>setValue({...value,startsAt:e.target.value})} /></label>
        <label><span>Przewidywany czas (min)</span><input type="number" min={10} max={480} value={value.plannedMinutes} onChange={(e)=>setValue({...value,plannedMinutes:Number(e.target.value)})} /></label>
        <label><span>Limit uczestników</span><input type="number" min={2} max={500} value={value.maxParticipants} onChange={(e)=>setValue({...value,maxParticipants:Number(e.target.value)})} /></label>
        <label><span>Odbiorcy</span><select value={value.audienceType} onChange={(e)=>setValue({...value,audienceType:e.target.value as AudienceType,targetIds:[]})}><option value="ALL">{role==='COORDINATOR'?'Wszyscy w moich punktach':'Wszyscy'}</option><option value="POINT">Wybrane punkty</option><option value="USER">Konkretni użytkownicy</option></select></label>
        {value.audienceType === 'POINT' && <div className="meeting-audience-picker"><span>Punkty ({value.targetIds.length})</span><div>{options?.points.map((item)=><label key={item.id}><input type="checkbox" checked={value.targetIds.includes(item.id)} onChange={()=>setValue({...value,targetIds:value.targetIds.includes(item.id)?value.targetIds.filter((id)=>id!==item.id):[...value.targetIds,item.id]})}/><span><strong>{item.name}</strong><small>{item.city}</small></span></label>)}</div></div>}
        {value.audienceType === 'USER' && <div className="meeting-audience-picker"><span>Osoby ({value.targetIds.length})</span><div>{options?.users.map((item)=><label key={item.id}><input type="checkbox" checked={value.targetIds.includes(item.id)} onChange={()=>setValue({...value,targetIds:value.targetIds.includes(item.id)?value.targetIds.filter((id)=>id!==item.id):[...value.targetIds,item.id]})}/><span><strong>{item.name}</strong><small>{item.email || item.role}</small></span></label>)}</div></div>}
        <label className="meeting-create-description"><span>Opis</span><textarea rows={4} maxLength={2000} value={value.description} onChange={(e)=>setValue({...value,description:e.target.value})} placeholder="Krótko opisz temat spotkania." /></label>
      </div>
      <div className="meeting-create-flags">
        <label><input type="checkbox" checked={value.allowParticipantAudio} onChange={(e)=>setValue({...value,allowParticipantAudio:e.target.checked})}/><Mic2 size={14}/> Zezwól na mikrofony uczestników</label>
        <label><input type="checkbox" checked={value.allowParticipantScreenShare} onChange={(e)=>setValue({...value,allowParticipantScreenShare:e.target.checked})}/><MonitorUp size={14}/> Zezwól na udostępnianie ekranu</label>
        <label className="meeting-email-optin"><input type="checkbox" checked={value.emailNotificationsEnabled} onChange={(e)=>setValue({...value,emailNotificationsEnabled:e.target.checked})}/><span><strong>Powiadom uczestników e-mailem</strong><small>Wyłączone oznacza: bez zaproszeń, zmian terminu i anulowania.</small></span></label>
      </div>
      <div className="meeting-editor-actions">
        <button className="button secondary" disabled={Boolean(busyId)} onClick={resetPanel}>Anuluj</button>
        <button className="button primary" disabled={busyId===busyKey} onClick={onSubmit}><CalendarDays size={15}/> {submitLabel}</button>
      </div>
    </div>
  );

  const renderMeeting = (meeting:MeetingSummary, historical=false) => {
    const full = meeting.registeredCount >= meeting.maxParticipants && !meeting.registeredByMe;
    const date=new Date(meeting.startsAt);
    return (
      <article className={'meeting-row meeting-row-'+meeting.status.toLowerCase()} key={meeting.id}>
        <div className="meeting-date-box">
          <CalendarDays size={18}/>
          <small>{date.toLocaleDateString('pl-PL',{weekday:'short'})}</small>
          <strong>{date.toLocaleDateString('pl-PL',{day:'2-digit',month:'2-digit'})}</strong>
          <span>{date.toLocaleTimeString('pl-PL',{hour:'2-digit',minute:'2-digit'})}</span>
        </div>
        <div className="meeting-main">
          <div className="meeting-title-line">
            <strong>{meeting.title}</strong>
            <span className={'meeting-status-badge status-'+meeting.status.toLowerCase()}>{statusLabel[meeting.status]}</span>
          </div>
          {meeting.description && <p>{meeting.description}</p>}
          <div className="meeting-meta">
            <span><Clock3 size={13}/> {meeting.plannedMinutes} min</span>
            <span><UsersRound size={13}/> {meeting.registeredCount}/{meeting.maxParticipants} zapisanych</span>
            <span><UserRound size={13}/> Prowadzący: {meeting.hostName}</span>
            <span className={meeting.allowParticipantAudio?'available':'unavailable'}><Mic2 size={13}/> Audio: {meeting.allowParticipantAudio?'dostępne':'wyłączone'}</span>
            <span className={meeting.allowParticipantScreenShare?'available':'unavailable'}><MonitorUp size={13}/> Ekran: {meeting.allowParticipantScreenShare?'dostępny':'wyłączony'}</span>
            {meeting.canManage&&<span className={meeting.emailNotificationsEnabled?'available':'unavailable'}>E-mail: {meeting.emailNotificationsEnabled?'włączony':'wyłączony'}</span>}
          </div>
          <div className="meeting-subline">
            <small>{meeting.status==='SCHEDULED'?meetingScheduleHint(meeting.startsAt):formatWhen(meeting.startsAt)}</small>
            {!meeting.canManage && meeting.registeredByMe && <span className="meeting-registered-note">✓ Jesteś zapisany</span>}
          </div>
        </div>
        <div className="meeting-actions">
          {meeting.status === 'SCHEDULED' && !meeting.canManage && (
            meeting.registeredByMe
              ? <button className="button secondary small" disabled={Boolean(busyId)} onClick={()=>void perform(meeting.id,'unregister')}>Wypisz się</button>
              : <button className="button primary small" disabled={Boolean(busyId)||full} onClick={()=>void perform(meeting.id,'register')}>{full?'Brak miejsc':'Zapisz się'}</button>
          )}
          {meeting.canManage && meeting.status === 'SCHEDULED' && <>
            <button className="button secondary small" disabled={Boolean(busyId)} onClick={()=>beginEdit(meeting)}>Edytuj</button>
            <button className="button secondary small" disabled={Boolean(busyId)} onClick={()=>beginReschedule(meeting)}>Zmień termin</button>
            <button className="button primary small" disabled={Boolean(busyId)} onClick={()=>void perform(meeting.id,'start')}>Rozpocznij spotkanie</button>
            <button className="button secondary small" disabled={Boolean(busyId)} onClick={()=>void confirmManagedAction(meeting,'cancel')}>Anuluj</button>
          </>}
          {meeting.status === 'LIVE' && (meeting.canManage || meeting.registeredByMe) && <button className="button primary small" disabled={Boolean(busyId)} onClick={()=>setActiveRoom(meeting)}>Otwórz pokój spotkania</button>}
          {meeting.canManage && meeting.status === 'LIVE' && <button className="button secondary small" disabled={Boolean(busyId)} onClick={()=>void confirmManagedAction(meeting,'end')}>Zakończ</button>}
          {!meeting.canManage && meeting.status === 'LIVE' && !meeting.registeredByMe && <span className="meeting-live-note">Zapisz się przed dołączeniem</span>}
          {historical && meeting.canManage && meeting.status === 'ENDED' && <button className="button secondary small" disabled={Boolean(busyId)} onClick={()=>void openAttendance(meeting)}>Frekwencja</button>}
        </div>
      </article>
    );
  };

  if (activeRoom) {
    return (
      <section className="meetings-card meetings-card-workspace">
        <MeetingRoom
          meeting={activeRoom}
          onClose={()=>{setActiveRoom(null);void load(true);}}
          onMeetingEnded={()=>void load(true)}
        />
      </section>
    );
  }

  if (attendanceMeeting) {
    return (
      <section className="meetings-card meetings-card-workspace">
        {renderPanelHeading('Frekwencja — '+attendanceMeeting.title,'Zapisani uczestnicy i rzeczywista obecność na spotkaniu.')}
        {error && <div className="meeting-error">{error}</div>}
        <div className="meeting-attendance-panel">
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
      </section>
    );
  }

  if (createOpen && canCreate) {
    return (
      <section className="meetings-card meetings-card-workspace">
        {renderPanelHeading('Zaplanuj spotkanie','Utwórz szkolenie, odprawę albo webinar i wybierz dokładnych odbiorców.')}
        {error && <div className="meeting-error">{error}</div>}
        {renderEditor(form,setForm,'Zapisz spotkanie',()=>void createMeeting(),'create')}
      </section>
    );
  }

  if (editedMeeting && editedMeeting.status==='SCHEDULED' && editedMeeting.canManage) {
    return (
      <section className="meetings-card meetings-card-workspace">
        {renderPanelHeading('Edytuj spotkanie','Zmień szczegóły, odbiorców i uprawnienia przed rozpoczęciem spotkania.')}
        {error && <div className="meeting-error">{error}</div>}
        {renderEditor(editForm,setEditForm,'Zapisz zmiany',()=>void saveEdit(editedMeeting.id),editedMeeting.id+':edit')}
      </section>
    );
  }

  if (rescheduledMeeting && rescheduledMeeting.status==='SCHEDULED' && rescheduledMeeting.canManage) {
    return (
      <section className="meetings-card meetings-card-workspace">
        {renderPanelHeading('Zmień termin','Ustaw nową datę i godzinę. Spotkanie pozostanie zaplanowane do jawnego rozpoczęcia przez prowadzącego.')}
        {error && <div className="meeting-error">{error}</div>}
        <div className="meeting-reschedule-panel">
          <div className="meeting-reschedule-summary">
            <strong>{rescheduledMeeting.title}</strong>
            <span>Obecny termin: {formatWhen(rescheduledMeeting.startsAt)}</span>
          </div>
          <label>
            <span>Nowa data i godzina</span>
            <input type="datetime-local" value={rescheduleValue} onChange={(e)=>setRescheduleValue(e.target.value)} />
          </label>
          <div className="meeting-editor-actions">
            <button className="button secondary" disabled={Boolean(busyId)} onClick={resetPanel}>Anuluj</button>
            <button className="button primary" disabled={Boolean(busyId)} onClick={()=>void saveReschedule(rescheduledMeeting.id)}>Zapisz nowy termin</button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="meetings-card">
      <div className="meetings-card-heading">
        <div>
          <span className="meetings-eyebrow"><Radio size={13} /> Spotkania i szkolenia</span>
          <h2>Najbliższe spotkania</h2>
          <p>Zapisuj się na szkolenia, odprawy i webinary bez wychodzenia z ServiceOS.</p>
        </div>
        {canCreate && (
          <button className="button primary small" onClick={openCreate}>
            <Plus size={14}/> Zaplanuj spotkanie
          </button>
        )}
      </div>

      {error && <div className="meeting-error">{error}</div>}
      {loading ? <div className="meeting-empty">Pobieram terminarz…</div> : visible.length === 0 ? (
        <div className="meeting-empty">Brak zaplanowanych spotkań.</div>
      ) : (
        <div className="meeting-list">{visible.map((meeting)=>renderMeeting(meeting))}</div>
      )}

      {canCreate && history.length>0 && (
        <details className="meeting-history">
          <summary>Ostatnie zakończone i anulowane ({history.length})</summary>
          <div className="meeting-list">{history.map((meeting)=>renderMeeting(meeting,true))}</div>
        </details>
      )}
    </section>
  );
}
