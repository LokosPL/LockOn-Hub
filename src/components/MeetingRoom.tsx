import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, MonitorUp, MonitorX, PhoneOff, Shield, UserMinus, VolumeX, X } from 'lucide-react';
import {
  Room,
  RoomEvent,
  Track,
  type LocalTrackPublication,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication
} from 'livekit-client';
import type { MeetingLiveParticipant, MeetingScreenSource, MeetingSummary } from '../types/electron';
import { useAppDialog } from './AppDialog';

type Props = {
  meeting: MeetingSummary;
  onClose: () => void;
  onMeetingEnded?: () => void;
};

const parseMetadataUserId = (value?: string | null) => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { serviceOsUserId?: unknown };
    return typeof parsed.serviceOsUserId === 'string' ? parsed.serviceOsUserId : null;
  } catch {
    return null;
  }
};

export function MeetingRoom({ meeting, onClose, onMeetingEnded }: Props) {
  const { confirm } = useAppDialog();
  const roomRef = useRef<Room | null>(null);
  const screenPublicationRef = useRef<LocalTrackPublication | null>(null);
  const attendanceOpenRef = useRef(false);
  const audioHostRef = useRef<HTMLDivElement | null>(null);
  const videoHostRef = useRef<HTMLDivElement | null>(null);
  const [joining, setJoining] = useState(true);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [micEnabled, setMicEnabled] = useState(false);
  const [screenEnabled, setScreenEnabled] = useState(false);
  const [canMic, setCanMic] = useState(false);
  const [canShare, setCanShare] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [participants, setParticipants] = useState<Array<{identity:string;name:string;local:boolean}>>([]);
  const [moderation, setModeration] = useState<MeetingLiveParticipant[]>([]);
  const [sources, setSources] = useState<MeetingScreenSource[]>([]);
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
  const [busy, setBusy] = useState('');

  const closeAttendance = () => {
    if (!attendanceOpenRef.current) return;
    attendanceOpenRef.current = false;
    void window.lockOn.meetings.attendanceAction(meeting.id,'LEAVE').catch(() => undefined);
  };

  const refreshParticipants = (room: Room) => {
    setParticipants([
      { identity: room.localParticipant.identity, name: room.localParticipant.name || 'Ty', local:true },
      ...Array.from(room.remoteParticipants.values()).map((item) => ({
        identity:item.identity,
        name:item.name || 'Uczestnik',
        local:false
      }))
    ]);
  };

  const attachTrack = (track: RemoteTrack) => {
    const element = track.attach();
    element.autoplay = true;
    if (track.kind === Track.Kind.Audio) {
      element.setAttribute('data-meeting-track', track.sid || '');
      audioHostRef.current?.appendChild(element);
      void (element as HTMLMediaElement).play().catch(() => undefined);
      return;
    }
    if (track.source === Track.Source.ScreenShare || track.source === Track.Source.ScreenShareAudio) {
      element.setAttribute('data-meeting-track', track.sid || '');
      element.classList.add('meeting-screen-video');
      videoHostRef.current?.appendChild(element);
      void (element as HTMLMediaElement).play().catch(() => undefined);
    }
  };

  const detachTrack = (track: RemoteTrack) => {
    for (const element of track.detach()) element.remove();
  };

  const loadModeration = async () => {
    if (!canManage) return;
    try {
      const data = await window.lockOn.meetings.participants(meeting.id);
      setModeration(data.participants ?? []);
    } catch {
      // Lista uczestników jest pomocnicza; chwilowy błąd nie rozłącza rozmowy.
    }
  };

  useEffect(() => {
    let disposed = false;
    const room = new Room({ adaptiveStream:true, dynacast:true });
    roomRef.current = room;

    const onSubscribed = (track: RemoteTrack, _publication: RemoteTrackPublication, _participant: RemoteParticipant) => attachTrack(track);
    const onUnsubscribed = (track: RemoteTrack) => detachTrack(track);
    const onParticipantChanged = () => refreshParticipants(room);
    const onDisconnected = () => {
      closeAttendance();
      if (!disposed) {
        setConnected(false);
        setMicEnabled(false);
        setScreenEnabled(false);
      }
    };

    room
      .on(RoomEvent.TrackSubscribed, onSubscribed)
      .on(RoomEvent.TrackUnsubscribed, onUnsubscribed)
      .on(RoomEvent.ParticipantConnected, onParticipantChanged)
      .on(RoomEvent.ParticipantDisconnected, onParticipantChanged)
      .on(RoomEvent.ParticipantNameChanged, onParticipantChanged)
      .on(RoomEvent.Disconnected, onDisconnected);

    void (async () => {
      try {
        const credentials = await window.lockOn.meetings.joinToken(meeting.id);
        if (disposed) return;
        setCanMic(credentials.permissions.microphone);
        setCanShare(credentials.permissions.screenShare);
        setCanManage(credentials.canManage);
        await room.connect(credentials.serverUrl, credentials.token, { autoSubscribe:true });
        if (disposed) {
          room.disconnect();
          return;
        }
        // Mikrofon pozostaje wyłączony po wejściu. Użytkownik włącza go świadomie.
        setConnected(true);
        await window.lockOn.meetings.attendanceAction(meeting.id,'JOIN').catch(() => undefined);
        attendanceOpenRef.current = true;
        refreshParticipants(room);
        for (const participant of room.remoteParticipants.values()) {
          for (const publication of participant.trackPublications.values()) {
            if (publication.track) attachTrack(publication.track);
          }
        }
      } catch (err) {
        if (!disposed) setError(err instanceof Error ? err.message : 'Nie udało się dołączyć do spotkania.');
      } finally {
        if (!disposed) setJoining(false);
      }
    })();

    return () => {
      disposed = true;
      for (const participant of room.remoteParticipants.values()) {
        for (const publication of participant.trackPublications.values()) {
          if (publication.track) detachTrack(publication.track);
        }
      }
      closeAttendance();
      const localScreen = screenPublicationRef.current?.track;
      if (localScreen) {
        void room.localParticipant.unpublishTrack(localScreen);
        localScreen.stop();
      }
      room.disconnect();
      roomRef.current = null;
    };
  }, [meeting.id]);

  useEffect(() => {
    if (!canManage || !connected) return;
    void loadModeration();
    const timer = window.setInterval(() => void loadModeration(), 4_000);
    return () => window.clearInterval(timer);
  }, [canManage, connected, meeting.id]);

  const toggleMic = async () => {
    const room = roomRef.current;
    if (!room || !canMic) return;
    setBusy('mic');
    setError('');
    try {
      const next = !micEnabled;
      await room.localParticipant.setMicrophoneEnabled(next);
      setMicEnabled(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się zmienić mikrofonu.');
    } finally {
      setBusy('');
    }
  };

  const openScreenPicker = async () => {
    if (!canShare || !roomRef.current) return;
    setBusy('screen');
    setError('');
    try {
      const list = await window.lockOn.meetings.screenSources();
      setSources(list);
      setSourcePickerOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się pobrać listy ekranów.');
    } finally {
      setBusy('');
    }
  };

  const startScreenShare = async (source: MeetingScreenSource) => {
    const room = roomRef.current;
    if (!room) return;
    setBusy('screen');
    setError('');
    try {
      const constraints = {
        mandatory: {
          chromeMediaSource:'desktop',
          chromeMediaSourceId:source.id,
          maxWidth:1920,
          maxHeight:1080,
          maxFrameRate:30
        }
      } as unknown as MediaTrackConstraints;
      const stream = await navigator.mediaDevices.getUserMedia({ video:constraints, audio:false });
      const mediaTrack = stream.getVideoTracks()[0];
      if (!mediaTrack) throw new Error('Nie udało się uruchomić udostępniania ekranu.');
      const publication = await room.localParticipant.publishTrack(mediaTrack, {
        source:Track.Source.ScreenShare,
        simulcast:true
      });
      screenPublicationRef.current = publication;
      setScreenEnabled(true);
      setSourcePickerOpen(false);
      mediaTrack.addEventListener('ended', () => {
        setScreenEnabled(false);
        screenPublicationRef.current = null;
      }, { once:true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się udostępnić wybranego ekranu.');
    } finally {
      setBusy('');
    }
  };

  const stopScreenShare = async () => {
    const room = roomRef.current;
    const publication = screenPublicationRef.current;
    if (!room || !publication?.track) return;
    setBusy('screen');
    try {
      await room.localParticipant.unpublishTrack(publication.track);
      publication.track.stop();
      screenPublicationRef.current = null;
      setScreenEnabled(false);
    } finally {
      setBusy('');
    }
  };

  const moderate = async (identity: string, action: 'MUTE'|'REMOVE'|'ALLOW_MIC'|'BLOCK_MIC') => {
    setBusy(identity+action);
    setError('');
    try {
      await window.lockOn.meetings.moderate(meeting.id,{identity,action});
      await loadModeration();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się wykonać akcji moderatora.');
    } finally {
      setBusy('');
    }
  };

  const endForEveryone = async () => {
    if (!canManage || busy) return;
    const accepted = await confirm({
      title:'Zakończyć spotkanie?',
      message:'Po zakończeniu wszyscy uczestnicy zostaną rozłączeni.',
      detail:'Frekwencja zostanie domknięta, a tego spotkania nie będzie można ponownie uruchomić.',
      confirmLabel:'Zakończ spotkanie',
      cancelLabel:'Wróć',
      tone:'warning'
    });
    if (!accepted) return;
    setBusy('end');
    setError('');
    try {
      await window.lockOn.meetings.action(meeting.id,'end');
      closeAttendance();
      roomRef.current?.disconnect();
      onMeetingEnded?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się zakończyć spotkania.');
    } finally {
      setBusy('');
    }
  };

  const leave = () => {
    closeAttendance();
    roomRef.current?.disconnect();
    onClose();
  };

  return (
    <div className="meeting-room-backdrop" role="dialog" aria-modal="true" aria-label={'Spotkanie: '+meeting.title}>
      <div className="meeting-room-shell">
        <header className="meeting-room-header">
          <div>
            <span className="meetings-eyebrow">Spotkanie na żywo</span>
            <h2>{meeting.title}</h2>
            <p>{joining ? 'Łączenie…' : connected ? participants.length+' uczestników online' : 'Rozłączono'}</p>
          </div>
          <button className="icon-button" onClick={leave} aria-label="Zamknij spotkanie"><X size={18}/></button>
        </header>

        {error && <div className="meeting-error">{error}</div>}

        <div className="meeting-room-layout">
          <main className="meeting-stage">
            <div className="meeting-screen-host" ref={videoHostRef}>
              {!connected && !joining && <div className="meeting-stage-empty">Nie udało się połączyć z pokojem.</div>}
              {connected && <div className="meeting-stage-empty meeting-stage-hint">Gdy prowadzący udostępni ekran, pojawi się tutaj.</div>}
            </div>
            <div className="meeting-audio-host" ref={audioHostRef} />
          </main>

          <aside className="meeting-participants-panel">
            <h3>Uczestnicy</h3>
            <div className="meeting-participant-list">
              {participants.map((item)=><div key={item.identity}><span>{item.name}</span>{item.local&&<small>Ty</small>}</div>)}
            </div>
            {canManage && moderation.length>0 && (
              <div className="meeting-moderation">
                <h3><Shield size={14}/> Moderacja</h3>
                {moderation.filter((item)=>item.identity!==roomRef.current?.localParticipant.identity).map((item)=>{
                  const userId=parseMetadataUserId(item.metadata);
                  return <div className="meeting-moderation-row" key={item.identity}>
                    <div><strong>{item.name}</strong>{userId&&<small>{userId.slice(0,18)}</small>}</div>
                    <div>
                      <button title="Wycisz" disabled={Boolean(busy)} onClick={()=>void moderate(item.identity,'MUTE')}><VolumeX size={13}/></button>
                      <button title="Zablokuj mikrofon" disabled={Boolean(busy)} onClick={()=>void moderate(item.identity,'BLOCK_MIC')}><MicOff size={13}/></button>
                      <button title="Pozwól mówić" disabled={Boolean(busy)} onClick={()=>void moderate(item.identity,'ALLOW_MIC')}><Mic size={13}/></button>
                      <button title="Usuń ze spotkania" disabled={Boolean(busy)} onClick={()=>void moderate(item.identity,'REMOVE')}><UserMinus size={13}/></button>
                    </div>
                  </div>;
                })}
              </div>
            )}
          </aside>
        </div>

        <footer className="meeting-room-controls">
          <button className={'meeting-control '+(micEnabled?'active':'')} disabled={!connected||!canMic||Boolean(busy)} onClick={()=>void toggleMic()}>
            {micEnabled?<Mic size={18}/>:<MicOff size={18}/>} {canMic?(micEnabled?'Wycisz mnie':'Włącz mikrofon'):'Mikrofon zablokowany'}
          </button>
          <button className={'meeting-control '+(screenEnabled?'active':'')} disabled={!connected||!canShare||Boolean(busy)} onClick={()=>void (screenEnabled?stopScreenShare():openScreenPicker())}>
            {screenEnabled?<MonitorX size={18}/>:<MonitorUp size={18}/>} {canShare?(screenEnabled?'Zatrzymaj ekran':'Udostępnij ekran'):'Udostępnianie zablokowane'}
          </button>
          {canManage && <button className="meeting-control danger" disabled={Boolean(busy)} onClick={()=>void endForEveryone()}><PhoneOff size={18}/> Zakończ dla wszystkich</button>}
          <button className="meeting-control danger" disabled={busy==='end'} onClick={leave}><PhoneOff size={18}/> Opuść spotkanie</button>
        </footer>
      </div>

      {sourcePickerOpen && (
        <div className="meeting-source-picker-backdrop">
          <div className="meeting-source-picker">
            <div className="meeting-source-picker-head"><div><strong>Wybierz ekran lub okno</strong><span>ServiceOS udostępni tylko wybrane źródło.</span></div><button className="icon-button" onClick={()=>setSourcePickerOpen(false)}><X size={17}/></button></div>
            <div className="meeting-source-grid">
              {sources.map((source)=><button key={source.id} onClick={()=>void startScreenShare(source)}>
                {source.thumbnail?<img src={source.thumbnail} alt="" />:<div className="meeting-source-placeholder"><MonitorUp size={28}/></div>}
                <span>{source.name}</span>
              </button>)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
