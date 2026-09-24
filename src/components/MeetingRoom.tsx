import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Hand, MessageSquare, Mic, MicOff, MonitorUp, MonitorX, PhoneOff, RefreshCw, Send, Shield, UserMinus, VolumeX, X } from 'lucide-react';
import {
  Room,
  RoomEvent,
  Track,
  type LocalTrackPublication,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication
} from 'livekit-client';
import type { MeetingChatMessage, MeetingHandRaise, MeetingLiveParticipant, MeetingScreenSource, MeetingSummary } from '../types/electron';
import { useAppDialog } from './AppDialog';

type Props = {
  meeting: MeetingSummary;
  onClose: () => void;
  onMeetingEnded?: () => void;
};

type ParticipantView = {
  identity:string;
  name:string;
  local:boolean;
  userId:string|null;
  muted:boolean;
  host:boolean;
  speaking:boolean;
  audioLevel:number;
};

const CONNECTION_ERROR_MESSAGE = 'Nie udało się połączyć ze spotkaniem. Sprawdź połączenie z internetem i spróbuj ponownie.';

const parseMetadataUserId = (value?: string | null) => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { serviceOsUserId?: unknown };
    return typeof parsed.serviceOsUserId === 'string' ? parsed.serviceOsUserId : null;
  } catch {
    return null;
  }
};

const participantView = (participant: Participant, meeting: MeetingSummary, local: boolean): ParticipantView => {
  const micPublication = Array.from(participant.trackPublications.values())
    .find((publication) => publication.source === Track.Source.Microphone);
  const userId = parseMetadataUserId(participant.metadata);
  return {
    identity:participant.identity,
    name:participant.name || (local ? 'Ty' : 'Uczestnik'),
    local,
    userId,
    muted:!micPublication || micPublication.isMuted,
    host:userId === meeting.hostUserId,
    speaking:participant.isSpeaking === true,
    audioLevel:Number.isFinite(participant.audioLevel) ? participant.audioLevel : 0
  };
};

const validateServerUrl = (value: string) => {
  const parsed = new URL(value);
  const local = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (parsed.protocol !== 'wss:' && !(local && parsed.protocol === 'ws:')) {
    throw new Error('Backend zwrócił nieprawidłowy LiveKit serverUrl.');
  }
  return parsed.toString().replace(/\/$/,'');
};

export function MeetingRoom({ meeting, onClose, onMeetingEnded }: Props) {
  const { confirm } = useAppDialog();
  const roomRef = useRef<Room | null>(null);
  const screenPublicationRef = useRef<LocalTrackPublication | null>(null);
  const attendanceOpenRef = useRef(false);
  const audioHostRef = useRef<HTMLDivElement | null>(null);
  const videoHostRef = useRef<HTMLDivElement | null>(null);
  const localPreviewRef = useRef<HTMLVideoElement | null>(null);
  const localPreviewStreamRef = useRef<MediaStream | null>(null);
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const [joining, setJoining] = useState(true);
  const [connected, setConnected] = useState(false);
  const [connectionFailed, setConnectionFailed] = useState(false);
  const [error, setError] = useState('');
  const [micEnabled, setMicEnabled] = useState(false);
  const [screenEnabled, setScreenEnabled] = useState(false);
  const [remoteScreenActive, setRemoteScreenActive] = useState(false);
  const [canMic, setCanMic] = useState(false);
  const [canShare, setCanShare] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [participants, setParticipants] = useState<ParticipantView[]>([]);
  const [moderation, setModeration] = useState<MeetingLiveParticipant[]>([]);
  const [sources, setSources] = useState<MeetingScreenSource[]>([]);
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
  const [selectedSource, setSelectedSource] = useState<MeetingScreenSource | null>(null);
  const [chatMessages, setChatMessages] = useState<MeetingChatMessage[]>([]);
  const [handRaises, setHandRaises] = useState<MeetingHandRaise[]>([]);
  const [handRaised, setHandRaised] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [sideTab, setSideTab] = useState<'participants'|'chat'>('participants');
  const [mobileView, setMobileView] = useState<'meeting'|'participants'|'chat'>('meeting');
  const [busy, setBusy] = useState('');

  const closeAttendance = () => {
    if (!attendanceOpenRef.current) return;
    attendanceOpenRef.current = false;
    void window.lockOn.meetings.attendanceAction(meeting.id,'LEAVE').catch(() => undefined);
  };

  const refreshParticipants = (room: Room) => {
    setParticipants([
      participantView(room.localParticipant,meeting,true),
      ...Array.from(room.remoteParticipants.values()).map((item) => participantView(item,meeting,false))
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
    if (track.source === Track.Source.ScreenShare) {
      element.setAttribute('data-meeting-track', track.sid || '');
      element.classList.add('meeting-screen-video');
      videoHostRef.current?.appendChild(element);
      setRemoteScreenActive(true);
      void (element as HTMLMediaElement).play().catch(() => undefined);
    }
  };

  const detachTrack = (track: RemoteTrack) => {
    for (const element of track.detach()) element.remove();
    if (track.source === Track.Source.ScreenShare) {
      const remaining = videoHostRef.current?.querySelectorAll('[data-meeting-track]').length ?? 0;
      setRemoteScreenActive(remaining > 0);
    }
  };

  const loadCollaboration = async () => {
    try {
      const [chat,hands] = await Promise.all([
        window.lockOn.meetings.chat(meeting.id),
        window.lockOn.meetings.hands(meeting.id)
      ]);
      setChatMessages(chat.messages ?? []);
      setHandRaises(hands.hands ?? []);
      setHandRaised(Boolean((hands.hands ?? []).some((item) => item.mine)));
    } catch (err) {
      console.warn('[meeting collaboration refresh]', {meetingId:meeting.id,message:err instanceof Error?err.message:String(err)});
    }
  };

  const loadModeration = async () => {
    if (!canManage) return;
    try {
      const data = await window.lockOn.meetings.participants(meeting.id);
      setModeration(data.participants ?? []);
    } catch (err) {
      console.warn('[meeting participants refresh]', {
        meetingId:meeting.id,
        message:err instanceof Error ? err.message : String(err)
      });
    }
  };

  useEffect(() => {
    let disposed = false;
    setJoining(true);
    setConnected(false);
    setConnectionFailed(false);
    setError('');
    setMicEnabled(false);
    setScreenEnabled(false);
    setRemoteScreenActive(false);
    setParticipants([]);

    const room = new Room({ adaptiveStream:true, dynacast:true });
    roomRef.current = room;

    const onSubscribed = (track: RemoteTrack, _publication: RemoteTrackPublication, _participant: RemoteParticipant) => {
      attachTrack(track);
      refreshParticipants(room);
    };
    const onUnsubscribed = (track: RemoteTrack) => {
      detachTrack(track);
      refreshParticipants(room);
    };
    const onParticipantChanged = () => refreshParticipants(room);
    const onTrackStateChanged = () => refreshParticipants(room);
    const onActiveSpeakersChanged = () => refreshParticipants(room);
    const onDisconnected = () => {
      closeAttendance();
      if (!disposed) {
        setConnected(false);
        setMicEnabled(false);
        setScreenEnabled(false);
        refreshParticipants(room);
      }
    };

    room
      .on(RoomEvent.TrackSubscribed, onSubscribed)
      .on(RoomEvent.TrackUnsubscribed, onUnsubscribed)
      .on(RoomEvent.TrackMuted, onTrackStateChanged)
      .on(RoomEvent.TrackUnmuted, onTrackStateChanged)
      .on(RoomEvent.LocalTrackPublished, onTrackStateChanged)
      .on(RoomEvent.LocalTrackUnpublished, onTrackStateChanged)
      .on(RoomEvent.ParticipantConnected, onParticipantChanged)
      .on(RoomEvent.ParticipantDisconnected, onParticipantChanged)
      .on(RoomEvent.ParticipantNameChanged, onParticipantChanged)
      .on(RoomEvent.ActiveSpeakersChanged, onActiveSpeakersChanged)
      .on(RoomEvent.Disconnected, onDisconnected);

    void (async () => {
      let diagnostics: { roomName?:string; serverUrl?:string } = {};
      try {
        const credentials = await window.lockOn.meetings.joinToken(meeting.id);
        if (disposed) return;
        const serverUrl = validateServerUrl(credentials.serverUrl);
        diagnostics = { roomName:credentials.roomName, serverUrl };
        setCanMic(credentials.permissions.microphone);
        setCanShare(credentials.permissions.screenShare);
        setCanManage(credentials.canManage);
        await room.connect(serverUrl, credentials.token, { autoSubscribe:true });
        if (disposed) {
          room.disconnect();
          return;
        }
        // Mikrofon pozostaje wyłączony po wejściu. Użytkownik włącza go świadomie.
        setConnected(true);
        setConnectionFailed(false);
        await window.lockOn.meetings.attendanceAction(meeting.id,'JOIN').catch((err) => {
          console.warn('[meeting attendance join]', {
            meetingId:meeting.id,
            message:err instanceof Error ? err.message : String(err)
          });
        });
        attendanceOpenRef.current = true;
        refreshParticipants(room);
        void loadCollaboration();
        for (const participant of room.remoteParticipants.values()) {
          for (const publication of participant.trackPublications.values()) {
            if (publication.track) attachTrack(publication.track);
          }
        }
      } catch (err) {
        console.error('[meeting connection]', {
          meetingId:meeting.id,
          roomName:diagnostics.roomName ?? null,
          serverUrl:diagnostics.serverUrl ?? null,
          errorName:err instanceof Error ? err.name : 'UnknownError',
          message:err instanceof Error ? err.message : String(err),
          stack:err instanceof Error ? err.stack : undefined
        });
        if (!disposed) {
          setConnectionFailed(true);
          setError(CONNECTION_ERROR_MESSAGE);
        }
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
      void window.lockOn.meetings.shareOverlay(null).catch(() => undefined);
      if (localPreviewRef.current) localPreviewRef.current.srcObject = null;
      localPreviewStreamRef.current = null;
      const localScreen = screenPublicationRef.current?.track;
      if (localScreen) {
        void room.localParticipant.unpublishTrack(localScreen);
        localScreen.stop();
      }
      screenPublicationRef.current = null;
      room.disconnect();
      roomRef.current = null;
    };
  }, [meeting.id, connectionAttempt]);

  useEffect(() => {
    if (!canManage || !connected) return;
    void loadModeration();
    const timer = window.setInterval(() => void loadModeration(), 4_000);
    return () => window.clearInterval(timer);
  }, [canManage, connected, meeting.id]);

  useEffect(() => {
    if (!connected) return;
    void loadCollaboration();
    const timer = window.setInterval(() => void loadCollaboration(), 1_750);
    return () => window.clearInterval(timer);
  }, [connected, meeting.id]);

  useEffect(() => {
    if (!connected) return;
    const room=roomRef.current;
    const timer=window.setInterval(()=>{if(room)refreshParticipants(room);},140);
    return () => window.clearInterval(timer);
  }, [connected, meeting.id]);

  useEffect(() => {
    const preview=localPreviewRef.current;
    if (!preview || !screenEnabled || !selectedSource || /LockOn ServiceOS/i.test(selectedSource.name)) return;
    preview.srcObject=localPreviewStreamRef.current;
    void preview.play().catch(()=>undefined);
    return () => { if (preview.srcObject===localPreviewStreamRef.current) preview.srcObject=null; };
  }, [screenEnabled, selectedSource?.id]);

  const retryConnection = () => {
    setError('');
    setConnectionFailed(false);
    setConnectionAttempt((value) => value + 1);
  };

  const toggleMic = async () => {
    const room = roomRef.current;
    if (!room || !canMic) return;
    setBusy('mic');
    setError('');
    try {
      const next = !micEnabled;
      await room.localParticipant.setMicrophoneEnabled(next);
      setMicEnabled(next);
      refreshParticipants(room);
    } catch (err) {
      console.error('[meeting microphone]', { meetingId:meeting.id, message:err instanceof Error ? err.message : String(err) });
      setError('Nie udało się zmienić stanu mikrofonu.');
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
      console.error('[meeting screen sources]', { meetingId:meeting.id, message:err instanceof Error ? err.message : String(err) });
      setError('Nie udało się pobrać listy ekranów.');
    } finally {
      setBusy('');
    }
  };

  const startScreenShare = async (source: MeetingScreenSource) => {
    const room = roomRef.current;
    if (!room || !canShare) return;
    setBusy('screen');
    setError('');
    try {
      const previous = screenPublicationRef.current;
      if (previous?.track) {
        screenPublicationRef.current = null;
        await room.localParticipant.unpublishTrack(previous.track).catch(() => undefined);
        previous.track.stop();
      }
      await window.lockOn.meetings.shareOverlay(null).catch(() => undefined);
      if (localPreviewRef.current) localPreviewRef.current.srcObject = null;
      localPreviewStreamRef.current = null;

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
      if (!mediaTrack) throw new Error('Brak tracka ekranu.');
      const publication = await room.localParticipant.publishTrack(mediaTrack, {
        source:Track.Source.ScreenShare,
        simulcast:true
      });
      screenPublicationRef.current = publication;
      setSelectedSource(source);
      setScreenEnabled(true);
      setSourcePickerOpen(false);

      const mirrorRisk=/LockOn ServiceOS/i.test(source.name);
      localPreviewStreamRef.current = mirrorRisk ? null : new MediaStream([mediaTrack]);
      if (localPreviewRef.current) {
        localPreviewRef.current.srcObject = localPreviewStreamRef.current;
        if (!mirrorRisk) void localPreviewRef.current.play().catch(() => undefined);
      }
      await window.lockOn.meetings.shareOverlay(source).catch(() => ({ok:true,shown:false}));

      mediaTrack.addEventListener('ended', () => {
        if (screenPublicationRef.current?.track !== publication.track) return;
        screenPublicationRef.current = null;
        setScreenEnabled(false);
        setSelectedSource(null);
        if (localPreviewRef.current) localPreviewRef.current.srcObject = null;
        localPreviewStreamRef.current = null;
        void room.localParticipant.unpublishTrack(publication.track).catch(() => undefined);
        void window.lockOn.meetings.shareOverlay(null).catch(() => undefined);
      }, { once:true });
    } catch (err) {
      console.error('[meeting screen share]', {
        meetingId:meeting.id,
        sourceId:source.id,
        message:err instanceof Error ? err.message : String(err)
      });
      setError('Nie udało się udostępnić wybranego ekranu.');
      await window.lockOn.meetings.shareOverlay(null).catch(() => undefined);
    } finally {
      setBusy('');
    }
  };

  const stopScreenShare = async () => {
    const room = roomRef.current;
    const publication = screenPublicationRef.current;
    if (!room || !publication?.track) {
      await window.lockOn.meetings.shareOverlay(null).catch(() => undefined);
      setScreenEnabled(false);
      setSelectedSource(null);
      return;
    }
    setBusy('screen');
    try {
      screenPublicationRef.current = null;
      await room.localParticipant.unpublishTrack(publication.track).catch(() => undefined);
      publication.track.stop();
      if (localPreviewRef.current) localPreviewRef.current.srcObject = null;
      localPreviewStreamRef.current = null;
      await window.lockOn.meetings.shareOverlay(null).catch(() => undefined);
      setSelectedSource(null);
      setScreenEnabled(false);
    } finally {
      setBusy('');
    }
  };

  const toggleHand = async () => {
    if (!connected || busy) return;
    setBusy('hand');
    try {
      await window.lockOn.meetings.setHandRaised(meeting.id,!handRaised);
      setHandRaised(!handRaised);
      await loadCollaboration();
    } catch (err) {
      setError('Nie udało się zmienić stanu podniesionej ręki.');
    } finally {
      setBusy('');
    }
  };

  const sendChat = async () => {
    const message=chatInput.trim();
    if (!message || !connected || busy) return;
    setBusy('chat');
    try {
      await window.lockOn.meetings.sendChat(meeting.id,message);
      setChatInput('');
      setSideTab('chat');
      await loadCollaboration();
    } catch (err) {
      setError('Nie udało się wysłać wiadomości.');
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
      console.error('[meeting moderation]', {
        meetingId:meeting.id,
        action,
        identity,
        message:err instanceof Error ? err.message : String(err)
      });
      setError('Nie udało się wykonać akcji moderatora.');
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
      await stopScreenShare();
      await window.lockOn.meetings.action(meeting.id,'end');
      closeAttendance();
      roomRef.current?.disconnect();
      onMeetingEnded?.();
      onClose();
    } catch (err) {
      console.error('[meeting end]', { meetingId:meeting.id, message:err instanceof Error ? err.message : String(err) });
      setError('Nie udało się zakończyć spotkania.');
    } finally {
      setBusy('');
    }
  };

  const leave = () => {
    closeAttendance();
    void stopScreenShare();
    roomRef.current?.disconnect();
    onClose();
  };

  return (
    <section className="meeting-room-panel" role="region" aria-label={'Spotkanie: '+meeting.title}>
      <div className="meeting-room-shell">
        <header className="meeting-room-header">
          <div>
            <div className="meeting-room-titleline">
              <span className="meeting-live-badge">● TRWA TERAZ</span>
              <h2>{meeting.title}</h2>
            </div>
            <div className="meeting-room-header-meta">
              <span>Prowadzący: <strong>{meeting.hostName}</strong></span>
              <span>Termin: <strong>{new Date(meeting.startsAt).toLocaleString('pl-PL',{dateStyle:'medium',timeStyle:'short'})}</strong></span>
              <span>Uczestnicy: <strong>{connected ? participants.length : 0}</strong></span>
            </div>
          </div>
          <button className="button secondary small meeting-room-back" onClick={leave}><ArrowLeft size={15}/> Wróć do spotkań</button>
        </header>

        {error && (
          <div className="meeting-error meeting-room-error">
            <span>{error}</span>
            {connectionFailed && <button className="button secondary small" disabled={joining} onClick={retryConnection}><RefreshCw size={14}/> Spróbuj ponownie</button>}
          </div>
        )}

        <div className="meeting-room-mobile-tabs" role="tablist" aria-label="Widok spotkania">
          <button className={mobileView==='meeting'?'active':''} onClick={()=>setMobileView('meeting')}>Spotkanie</button>
          <button className={mobileView==='participants'?'active':''} onClick={()=>{setSideTab('participants');setMobileView('participants');}}>Uczestnicy</button>
          <button className={mobileView==='chat'?'active':''} onClick={()=>{setSideTab('chat');setMobileView('chat');}}>Chat {chatMessages.length>0&&<b>{chatMessages.length}</b>}</button>
        </div>
        <div className="meeting-room-layout">
          <main className={'meeting-stage '+(mobileView!=='meeting'?'meeting-mobile-hidden':'')}>
            <div className="meeting-screen-host" ref={videoHostRef}>
              {joining && <div className="meeting-stage-empty">Łączenie ze spotkaniem…</div>}
              {!joining && !connected && <div className="meeting-stage-empty">Połączenie nie jest aktywne.</div>}
              {connected && !remoteScreenActive && <div className="meeting-stage-empty meeting-stage-hint"><MonitorUp size={30}/><strong>Nikt nie udostępnia ekranu</strong><span>Udostępniany ekran prowadzącego lub uczestnika pojawi się tutaj.</span></div>}
            </div>
            {screenEnabled && selectedSource && (
              <div className="meeting-local-share-preview">
                <div><span>● Udostępniasz ekran</span><strong>{selectedSource.name}</strong></div>
                {/LockOn ServiceOS/i.test(selectedSource.name)
                  ? <p>Podgląd ukryty, aby uniknąć efektu nieskończonego lustra. Uczestnicy nadal widzą wybrane źródło.</p>
                  : <video ref={localPreviewRef} muted playsInline autoPlay />}
                <div className="meeting-local-share-actions">
                  <button onClick={()=>void openScreenPicker()}><RefreshCw size={14}/> Zmień ekran / okno</button>
                  <button onClick={()=>void stopScreenShare()}><MonitorX size={14}/> Zatrzymaj udostępnianie</button>
                </div>
              </div>
            )}
            <div className="meeting-audio-host" ref={audioHostRef} />
          </main>

          <aside className={'meeting-participants-panel meeting-side-'+sideTab+' '+(mobileView==='meeting'?'meeting-mobile-hidden':'')}>
            <div className="meeting-side-tabs" role="tablist">
              <button className={sideTab==='participants'?'active':''} onClick={()=>setSideTab('participants')}><Shield size={14}/> Uczestnicy</button>
              <button className={sideTab==='chat'?'active':''} onClick={()=>setSideTab('chat')}><MessageSquare size={14}/> Chat</button>
            </div>
            {sideTab==='participants' ? <>
              <div className="meeting-participants-heading"><h3>Uczestnicy</h3><span>{participants.length}</span></div>
              {canManage && handRaises.length>0 && <div className="meeting-hand-queue"><strong><Hand size={14}/> Chcą zabrać głos</strong>{handRaises.map((item)=><span key={item.userId}><b>{item.position}</b>{item.name}</span>)}</div>}
              <div className="meeting-participant-list">
                {participants.map((item)=>{
                  const hand=handRaises.find((raised)=>raised.userId===item.userId);
                  return <div key={item.identity} className={'meeting-participant-item '+(item.speaking?'speaking':'')}>
                    <div>
                      <span>{item.name} {hand&&<em title="Podniesiona ręka">✋</em>}</span>
                      <small>{item.speaking?'Mówi':item.host?'Prowadzący':item.local?'Ty':'Uczestnik'}</small>
                      {!item.muted&&<span className="meeting-audio-level"><i style={{width:(Math.max(6,Math.min(100,item.audioLevel*140)))+'%'}} /></span>}
                    </div>
                    <span className={'meeting-participant-mic '+(item.muted?'muted':'active')} title={item.muted?'Mikrofon wyciszony':'Mikrofon włączony'}>
                      {item.muted?<MicOff size={14}/>:<Mic size={14}/>}
                    </span>
                  </div>;
                })}
              </div>
              {canManage && moderation.length>0 && (
                <div className="meeting-moderation">
                  <h3><Shield size={14}/> Moderacja</h3>
                  {moderation.filter((item)=>item.identity!==roomRef.current?.localParticipant.identity).map((item)=>{
                    const userId=parseMetadataUserId(item.metadata);
                    return <div className="meeting-moderation-row" key={item.identity}>
                      <div><strong>{item.name}</strong>{userId&&<small>{userId===meeting.hostUserId?'Prowadzący':userId.slice(0,18)}</small>}</div>
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
            </> : <div className="meeting-chat-panel">
              <div className="meeting-chat-messages">
                {chatMessages.length===0?<div className="meeting-chat-empty">Brak wiadomości. Napisz pierwszą.</div>:chatMessages.map((message)=><article key={message.id} className={message.mine?'mine':''}><div><strong>{message.authorName}</strong><time>{new Date(message.createdAt).toLocaleTimeString('pl-PL',{hour:'2-digit',minute:'2-digit'})}</time></div><p>{message.body}</p></article>)}
              </div>
              <div className="meeting-chat-compose">
                <input value={chatInput} maxLength={2000} placeholder="Napisz wiadomość…" onChange={(e)=>setChatInput(e.target.value)} onKeyDown={(e)=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void sendChat();}}} />
                <button disabled={!chatInput.trim()||Boolean(busy)} onClick={()=>void sendChat()} aria-label="Wyślij wiadomość"><Send size={16}/></button>
              </div>
            </div>}
          </aside>
        </div>

        <footer className="meeting-room-controls">
          <button className={'meeting-control '+(micEnabled?'active':'')} disabled={!connected||!canMic||Boolean(busy)} onClick={()=>void toggleMic()}>
            {micEnabled?<Mic size={18}/>:<MicOff size={18}/>} {canMic?(micEnabled?'Wyłącz mikrofon':'Włącz mikrofon'):'Mikrofon zablokowany'}
          </button>
          <button className={'meeting-control '+(screenEnabled?'active':'')} disabled={!connected||!canShare||Boolean(busy)} onClick={()=>void (screenEnabled?openScreenPicker():openScreenPicker())}>
            {screenEnabled?<RefreshCw size={18}/>:<MonitorUp size={18}/>} {canShare?(screenEnabled?'Zmień ekran / okno':'Udostępnij ekran'):'Udostępnianie zablokowane'}
          </button>
          <button className={'meeting-control '+(handRaised?'active':'')} disabled={!connected||Boolean(busy)} onClick={()=>void toggleHand()}><Hand size={18}/> {handRaised?'Opuść rękę':'Podnieś rękę'}</button>
          {screenEnabled&&<button className="meeting-control" disabled={Boolean(busy)} onClick={()=>void stopScreenShare()}><MonitorX size={18}/> Zatrzymaj</button>}
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
    </section>
  );
}
