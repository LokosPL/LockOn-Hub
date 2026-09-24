import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Clock3, Eye, EyeOff, Hand, Maximize2, MessageSquare, Mic, MicOff, Minimize2, Monitor, MonitorUp, MonitorX, PhoneOff, RefreshCw, Send, Shield, UserMinus, UsersRound, VolumeX, X } from 'lucide-react';
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
import type { MeetingChatMessage, MeetingHandRaise, MeetingLiveParticipant, MeetingScreenSource, MeetingShareOverlayState, MeetingSummary } from '../types/electron';
import { formatMeetingElapsed, publishMeetingLiveState, type MeetingLiveUiState } from '../meetingLiveState';
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
  const remotePreviewHostRef = useRef<HTMLDivElement | null>(null);
  const remoteScreenOwnersRef = useRef<Map<string,string>>(new Map());
  const localStagePreviewRef = useRef<HTMLVideoElement | null>(null);
  const localPreviewStreamRef = useRef<MediaStream | null>(null);
  const chatMessagesRef = useRef<HTMLDivElement | null>(null);
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const [joining, setJoining] = useState(true);
  const [connected, setConnected] = useState(false);
  const [connectionFailed, setConnectionFailed] = useState(false);
  const [error, setError] = useState('');
  const [micEnabled, setMicEnabled] = useState(false);
  const [screenEnabled, setScreenEnabled] = useState(false);
  const [remoteScreenActive, setRemoteScreenActive] = useState(false);
  const [remoteScreenOwner, setRemoteScreenOwner] = useState('');
  const [stageView, setStageView] = useState<'empty'|'self'|'remote'>('empty');
  const [showSelfPreview, setShowSelfPreview] = useState(false);
  const [theaterMode, setTheaterMode] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
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
  const [sideTab, setSideTab] = useState<'participants'|'chat'>('chat');
  const [mobileView, setMobileView] = useState<'meeting'|'participants'|'chat'>('meeting');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    if (!theaterMode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTheaterMode(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [theaterMode]);



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

  const attachTrack = (track: RemoteTrack, participant?: Participant) => {
    const sid = track.sid || '';
    if (track.kind === Track.Kind.Audio) {
      const alreadyAttached = Array.from(audioHostRef.current?.querySelectorAll('[data-meeting-track]') ?? [])
        .some((element) => element.getAttribute('data-meeting-track') === sid);
      if (alreadyAttached) return;
      const element = track.attach();
      element.autoplay = true;
      element.setAttribute('data-meeting-track', sid);
      audioHostRef.current?.appendChild(element);
      void (element as HTMLMediaElement).play().catch(() => undefined);
      return;
    }
    if (track.source === Track.Source.ScreenShare) {
      const alreadyAttached = Array.from(videoHostRef.current?.querySelectorAll('[data-meeting-track]') ?? [])
        .some((element) => element.getAttribute('data-meeting-track') === sid);
      if (alreadyAttached) return;

      const stageElement = track.attach();
      stageElement.autoplay = true;
      stageElement.muted = true;
      stageElement.setAttribute('data-meeting-track', sid);
      stageElement.classList.add('meeting-screen-video');
      videoHostRef.current?.appendChild(stageElement);
      void (stageElement as HTMLMediaElement).play().catch(() => undefined);

      const previewElement = track.attach();
      previewElement.autoplay = true;
      previewElement.muted = true;
      previewElement.setAttribute('data-meeting-preview-track', sid);
      previewElement.classList.add('meeting-screen-thumb-video');
      remotePreviewHostRef.current?.appendChild(previewElement);
      void (previewElement as HTMLMediaElement).play().catch(() => undefined);

      const ownerName = participant?.name || 'Uczestnik';
      remoteScreenOwnersRef.current.set(sid, ownerName);
      setRemoteScreenOwner(ownerName);
      setRemoteScreenActive(true);
      setStageView((current) => current === 'empty' ? 'remote' : current);
    }
  };

  const detachTrack = (track: RemoteTrack) => {
    for (const element of track.detach()) element.remove();
    if (track.source === Track.Source.ScreenShare) {
      remoteScreenOwnersRef.current.delete(track.sid || '');
      const remaining = videoHostRef.current?.querySelectorAll('[data-meeting-track]').length ?? 0;
      const active = remaining > 0;
      setRemoteScreenActive(active);
      if (!active) {
        setRemoteScreenOwner('');
        setStageView((current) => current === 'remote'
          ? (screenPublicationRef.current?.track ? 'self' : 'empty')
          : current);
      } else {
        const owners = Array.from(remoteScreenOwnersRef.current.values());
        setRemoteScreenOwner(owners[owners.length - 1] || 'Uczestnik');
      }
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
    setRemoteScreenOwner('');
    remoteScreenOwnersRef.current.clear();
    setStageView('empty');
    setParticipants([]);

    const room = new Room({
      adaptiveStream:false,
      dynacast:false,
      audioCaptureDefaults:{
        echoCancellation:true,
        noiseSuppression:true,
        autoGainControl:true,
        channelCount:1,
        sampleRate:48_000,
        latency:{ideal:0.01,max:0.04}
      },
      publishDefaults:{
        dtx:false,
        red:true,
        stopMicTrackOnMute:false
      }
    });
    roomRef.current = room;

    const onSubscribed = (track: RemoteTrack, _publication: RemoteTrackPublication, participant: RemoteParticipant) => {
      attachTrack(track, participant);
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
            if (publication.track) attachTrack(publication.track, participant);
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
      publishMeetingLiveState(null);
      void window.lockOn.meetings.shareOverlay(null).catch(() => undefined);
      if (localStagePreviewRef.current) localStagePreviewRef.current.srcObject = null;
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
    const timer=window.setInterval(()=>{if(room)refreshParticipants(room);},100);
    return () => window.clearInterval(timer);
  }, [connected, meeting.id]);

  useEffect(() => {
    const host=chatMessagesRef.current;
    if (!host || sideTab!=='chat') return;
    host.scrollTo({top:host.scrollHeight,behavior:'smooth'});
  }, [chatMessages.length, sideTab]);

  useEffect(() => {
    if (!screenEnabled || !selectedSource || !showSelfPreview || /LockOn ServiceOS/i.test(selectedSource.name)) return;
    const stream = localPreviewStreamRef.current;
    const preview = localStagePreviewRef.current;
    if (!stream || !preview) return;
    preview.srcObject = stream;
    void preview.play().catch(() => undefined);
    return () => {
      if (preview.srcObject === stream) preview.srcObject = null;
    };
  }, [screenEnabled, selectedSource?.id, showSelfPreview, stageView]);

  useEffect(() => {
    const started = new Date(meeting.startedAt || meeting.startsAt).getTime();
    const refresh = () => {
      setElapsedSeconds(Number.isFinite(started) ? Math.max(0, Math.floor((Date.now() - started) / 1000)) : 0);
    };
    refresh();
    const timer = window.setInterval(refresh, 1_000);
    return () => window.clearInterval(timer);
  }, [meeting.id, meeting.startedAt, meeting.startsAt]);

  useEffect(() => {
    const speakingNames = participants.filter((item) => item.speaking && !item.muted).map((item) => item.name).slice(0,4);
    const latest = chatMessages[chatMessages.length - 1] ?? null;
    const liveState: MeetingLiveUiState = {
      meetingId:meeting.id,
      meetingTitle:meeting.title,
      startedAt:meeting.startedAt || meeting.startsAt,
      plannedMinutes:meeting.plannedMinutes,
      elapsedSeconds,
      participantCount:connected ? participants.length : 0,
      speakingNames,
      micEnabled,
      screenEnabled,
      sourceName:selectedSource?.name ?? null,
      handCount:handRaises.length,
      latestMessage:latest ? {authorName:latest.mine ? 'Ty' : latest.authorName,body:latest.body} : null
    };
    publishMeetingLiveState(liveState);
    if (screenEnabled) {
      const overlayState: MeetingShareOverlayState = liveState;
      void window.lockOn.meetings.updateShareOverlay(overlayState).catch(() => undefined);
    }
  }, [
    meeting.id,
    meeting.title,
    meeting.startedAt,
    meeting.startsAt,
    meeting.plannedMinutes,
    elapsedSeconds,
    connected,
    participants,
    micEnabled,
    screenEnabled,
    selectedSource?.name,
    handRaises.length,
    chatMessages
  ]);

  const toggleTheaterMode = () => {
    setTheaterMode((current) => {
      const next = !current;
      if (next) {
        setSideTab('chat');
        setMobileView('meeting');
      }
      return next;
    });
  };

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
      localPreviewStreamRef.current = null;

      const constraints = {
        mandatory: {
          chromeMediaSource:'desktop',
          chromeMediaSourceId:source.id,
          maxWidth:3840,
          maxHeight:2160,
          maxFrameRate:60
        }
      } as unknown as MediaTrackConstraints;
      const stream = await navigator.mediaDevices.getUserMedia({ video:constraints, audio:false });
      const mediaTrack = stream.getVideoTracks()[0];
      if (!mediaTrack) throw new Error('Brak tracka ekranu.');
      mediaTrack.contentHint = 'detail';
      const publication = await room.localParticipant.publishTrack(mediaTrack, {
        source:Track.Source.ScreenShare,
        simulcast:false,
        screenShareEncoding:{
          maxBitrate:12_000_000,
          maxFramerate:60,
          priority:'high'
        },
        degradationPreference:'maintain-resolution'
      });
      screenPublicationRef.current = publication;
      setSelectedSource(source);
      setScreenEnabled(true);
      setShowSelfPreview(false);
      setStageView('self');
      setSourcePickerOpen(false);

      const mirrorRisk=/LockOn ServiceOS/i.test(source.name);
      localPreviewStreamRef.current = mirrorRisk ? null : new MediaStream([mediaTrack]);
      await window.lockOn.meetings.shareOverlay(source).catch(() => ({ok:true,shown:false}));
      const speakingNames = participants.filter((item) => item.speaking && !item.muted).map((item) => item.name).slice(0,4);
      const latest = chatMessages[chatMessages.length - 1] ?? null;
      await window.lockOn.meetings.updateShareOverlay({
        meetingId:meeting.id,
        meetingTitle:meeting.title,
        startedAt:meeting.startedAt || meeting.startsAt,
        plannedMinutes:meeting.plannedMinutes,
        elapsedSeconds,
        participantCount:participants.length,
        speakingNames,
        micEnabled,
        handCount:handRaises.length,
        latestMessage:latest ? {authorName:latest.mine ? 'Ty' : latest.authorName,body:latest.body} : null
      }).catch(() => ({ok:true,shown:false}));

      mediaTrack.addEventListener('ended', () => {
        if (screenPublicationRef.current?.track !== publication.track) return;
        screenPublicationRef.current = null;
        setScreenEnabled(false);
        setShowSelfPreview(false);
        setSelectedSource(null);
        setStageView((current) => current === 'self'
          ? (remoteScreenOwnersRef.current.size > 0 ? 'remote' : 'empty')
          : current);
          if (localStagePreviewRef.current) localStagePreviewRef.current.srcObject = null;
        localPreviewStreamRef.current = null;
        void room.localParticipant.unpublishTrack(mediaTrack).catch(() => undefined);
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
      setShowSelfPreview(false);
      setSelectedSource(null);
      setStageView((current) => current === 'self'
        ? (remoteScreenOwnersRef.current.size > 0 ? 'remote' : 'empty')
        : current);
      return;
    }
    setBusy('screen');
    try {
      screenPublicationRef.current = null;
      await room.localParticipant.unpublishTrack(publication.track).catch(() => undefined);
      publication.track.stop();
      if (localStagePreviewRef.current) localStagePreviewRef.current.srcObject = null;
      localPreviewStreamRef.current = null;
      await window.lockOn.meetings.shareOverlay(null).catch(() => undefined);
      setSelectedSource(null);
      setScreenEnabled(false);
      setShowSelfPreview(false);
      setStageView((current) => current === 'self'
        ? (remoteScreenOwnersRef.current.size > 0 ? 'remote' : 'empty')
        : current);
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
    <section className={'meeting-room-panel '+(theaterMode?'theater-mode':'')} role="region" aria-label={'Spotkanie: '+meeting.title}>
      <div className="meeting-room-shell">
        <header className="meeting-room-header">
          <div>
            <div className="meeting-room-titleline">
              <span className="meeting-live-badge">● TRWA TERAZ</span>
              <h2>{meeting.title}</h2>
            </div>
            <div className="meeting-room-header-meta">
              <span>Prowadzący: <strong>{meeting.hostName}</strong></span>
              <span><Clock3 size={12}/> <strong>{formatMeetingElapsed(elapsedSeconds)}</strong> / {meeting.plannedMinutes} min</span>
              <span><UsersRound size={12}/> <strong>{connected ? participants.length : 0}</strong> {participants.length === 1 ? 'uczestnik' : 'uczestników'}</span>
              {participants.some((item)=>item.speaking&&!item.muted) && (
                <span className="meeting-speaking-meta"><i /> Mówi: <strong>{participants.filter((item)=>item.speaking&&!item.muted).slice(0,2).map((item)=>item.name).join(', ')}</strong></span>
              )}
            </div>
          </div>
          <div className="meeting-room-header-actions">
            <button
              className={'button secondary small meeting-theater-toggle '+(theaterMode?'active':'')}
              type="button"
              onClick={toggleTheaterMode}
              title={theaterMode?'Wróć do standardowego widoku':'Powiększ ekran spotkania i zostaw czat po prawej'}
            >
              {theaterMode?<Minimize2 size={15}/>:<Maximize2 size={15}/>}
              {theaterMode?'Widok standardowy':'Tryb kinowy'}
            </button>
            <button className="button secondary small meeting-room-back" onClick={leave}><ArrowLeft size={15}/> Wróć do spotkań</button>
          </div>
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
            <div className={'meeting-screen-workspace stage-'+stageView}>
              {stageView === 'empty' ? (
                <div className="meeting-screen-empty-state">
                  <div className="meeting-screen-empty-visual"><MonitorUp size={42}/></div>
                  <strong>Nikt nie udostępnia ekranu</strong>
                  <span>Gdy Ty lub uczestnik zaczniecie udostępniać, obraz pojawi się tutaj.</span>
                  {canShare && (
                    <button className="button primary" type="button" disabled={!connected || Boolean(busy)} onClick={()=>void openScreenPicker()}>
                      <MonitorUp size={16}/> Udostępnij ekran
                    </button>
                  )}
                </div>
              ) : (
                <>
                  {stageView === 'remote' && (
                    <div className="meeting-screen-stage-header">
                      <div>
                        <Monitor size={15}/>
                        <strong>{remoteScreenOwner || 'Udostępniany ekran'}</strong>
                      </div>
                      <small>Udostępniany ekran uczestnika</small>
                    </div>
                  )}

                  <div
                    className={'meeting-screen-main '+(stageView==='self'?'self-stage':'remote-stage')}
                    onDoubleClick={toggleTheaterMode}
                    title="Kliknij dwukrotnie, aby przełączyć Tryb kinowy"
                  >
                    {stageView === 'self' && (
                      showSelfPreview && !/LockOn ServiceOS/i.test(selectedSource?.name || '') ? (
                        <video ref={localStagePreviewRef} className="meeting-local-stage-video" muted playsInline autoPlay />
                      ) : (
                        <div className="meeting-broadcast-stage">
                          <span className="meeting-broadcast-live"><i /> TRANSMISJA AKTYWNA</span>
                          <div className="meeting-broadcast-icon"><MonitorUp size={38}/></div>
                          <strong>{selectedSource?.name || 'Udostępniany ekran'}</strong>
                          <span>Obraz jest wysyłany uczestnikom. Lokalny podgląd jest domyślnie ukryty, żeby nie tworzyć efektu lustra.</span>
                          {!/LockOn ServiceOS/i.test(selectedSource?.name || '') && (
                            <button type="button" onClick={()=>setShowSelfPreview(true)}><Eye size={15}/> Pokaż lokalny podgląd</button>
                          )}
                        </div>
                      )
                    )}
                    <div className="meeting-screen-host" ref={videoHostRef} aria-hidden={stageView!=='remote'} />
                    {stageView==='remote' && joining && <div className="meeting-stage-status">Łączenie ze spotkaniem…</div>}
                    {stageView==='remote' && !joining && !connected && <div className="meeting-stage-status">Połączenie nie jest aktywne.</div>}
                  </div>
                </>
              )}
            </div>

            {remoteScreenActive && (
              <div className="meeting-screen-filmstrip" aria-label="Udostępniane ekrany uczestników">
                <button
                  type="button"
                  className={'meeting-screen-tile '+(stageView==='remote'?'selected':'')}
                  onClick={()=>setStageView('remote')}
                >
                  <div className="meeting-screen-tile-preview">
                    <div className="meeting-remote-preview-host" ref={remotePreviewHostRef} />
                  </div>
                  <div>
                    <strong>{(remoteScreenOwner || 'Uczestnik')+' udostępnia'}</strong>
                    <span>Kliknij, aby pokazać na głównym ekranie</span>
                  </div>
                </button>
                {screenEnabled && (
                  <button type="button" className="meeting-screen-self-return" onClick={()=>setStageView('self')}>
                    <MonitorUp size={15}/>
                    <span>Wróć do swojej transmisji</span>
                  </button>
                )}
              </div>
            )}

            {screenEnabled && selectedSource && (
              <div className="meeting-broadcast-strip">
                <div className="meeting-broadcast-strip-source">
                  <span><i /> UDOSTĘPNIASZ</span>
                  <strong>{selectedSource.name}</strong>
                </div>
                <div className="meeting-broadcast-strip-stats">
                  <span><Clock3 size={13}/><b>{formatMeetingElapsed(elapsedSeconds)}</b></span>
                  <span><UsersRound size={13}/><b>{participants.length}</b></span>
                  {participants.some((item)=>item.speaking&&!item.muted) && <span className="speaking"><i/> {participants.filter((item)=>item.speaking&&!item.muted)[0]?.name}</span>}
                  <span className="quality"><Monitor size={13}/> 4K / 60</span>
                </div>
                <div className="meeting-local-share-actions">
                  {!/LockOn ServiceOS/i.test(selectedSource.name) && (
                    <button onClick={()=>setShowSelfPreview((value)=>!value)}>
                      {showSelfPreview?<EyeOff size={14}/>:<Eye size={14}/>} {showSelfPreview?'Ukryj podgląd':'Podgląd'}
                    </button>
                  )}
                  <button onClick={toggleTheaterMode}>{theaterMode?<Minimize2 size={14}/>:<Maximize2 size={14}/>} {theaterMode?'Standardowy':'Kinowy'}</button>
                  <button onClick={()=>void openScreenPicker()}><RefreshCw size={14}/> Zmień źródło</button>
                  <button className="danger" onClick={()=>void stopScreenShare()}><MonitorX size={14}/> Zatrzymaj</button>
                </div>
              </div>
            )}
            <div className="meeting-audio-host" ref={audioHostRef} />
          </main>

          <aside className={'meeting-participants-panel meeting-side-'+sideTab+' '+(mobileView==='meeting'?'meeting-mobile-hidden':'')}>
            <div className="meeting-side-tabs" role="tablist">
              <button className={sideTab==='chat'?'active':''} onClick={()=>setSideTab('chat')}><MessageSquare size={14}/> Czat {chatMessages.length>0&&<b>{chatMessages.length}</b>}</button>
              <button className={sideTab==='participants'?'active':''} onClick={()=>setSideTab('participants')}><UsersRound size={14}/> Uczestnicy <b>{participants.length}</b></button>
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
              <div className="meeting-chat-messages" ref={chatMessagesRef}>
                {chatMessages.length===0?<div className="meeting-chat-empty">Brak wiadomości. Napisz pierwszą.</div>:chatMessages.map((message)=><article key={message.id} className={message.mine?'mine':''}><div><strong>{message.mine?'Ty':message.authorName}</strong><time>{new Date(message.createdAt).toLocaleTimeString('pl-PL',{hour:'2-digit',minute:'2-digit'})}</time></div><p>{message.body}</p></article>)}
              </div>
              <div className="meeting-chat-compose">
                <input value={chatInput} maxLength={2000} placeholder="Napisz wiadomość…" onChange={(e)=>setChatInput(e.target.value)} onKeyDown={(e)=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void sendChat();}}} />
                <button disabled={!chatInput.trim()||Boolean(busy)} onClick={()=>void sendChat()} aria-label="Wyślij wiadomość"><Send size={16}/></button>
              </div>
              {canManage && (
                <div className="meeting-chat-hands">
                  <div className="meeting-chat-hands-head"><strong><Hand size={14}/> Podniesione ręce ({handRaises.length})</strong></div>
                  {handRaises.length===0
                    ? <span className="meeting-chat-hands-empty">Nikt nie czeka na głos.</span>
                    : handRaises.map((item)=><div key={item.userId}><b>{item.position}</b><span>{item.name}</span><Hand size={13}/></div>)}
                </div>
              )}
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
          <button className={'meeting-control '+(sideTab==='chat'?'active':'')} onClick={()=>{setSideTab('chat');setMobileView('chat');}}><MessageSquare size={18}/> Czat {chatMessages.length>0&&<b className="meeting-control-badge">{chatMessages.length}</b>}</button>
          <button className={'meeting-control '+(sideTab==='participants'?'active':'')} onClick={()=>{setSideTab('participants');setMobileView('participants');}}><UsersRound size={18}/> Uczestnicy <b className="meeting-control-badge">{participants.length}</b></button>
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
