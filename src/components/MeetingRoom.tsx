import { useEffect, useMemo, useRef, useState } from 'react';
import {
  LocalTrack,
  RemoteTrack,
  Room,
  RoomEvent,
  Track
} from 'livekit-client';
import {
  Mic, MicOff, MonitorUp, MonitorX, PhoneOff, RefreshCw, Shield,
  UserMinus, UsersRound, VolumeX, X
} from 'lucide-react';
import type {
  MeetingDisplaySource, MeetingJoinCredentials, MeetingSummary
} from '../types/electron';

interface MeetingRoomProps {
  meeting: MeetingSummary;
  currentUserId?: string | null;
  onClose: () => void;
}

interface ParticipantRow {
  identity:string;
  name:string;
  microphoneTrackSid:string|null;
  microphoneMuted:boolean;
  sharingScreen:boolean;
}

const displayError = (error:unknown) =>
  error instanceof Error ? error.message : 'Nie udało się wykonać operacji spotkania.';

export function MeetingRoom({ meeting, currentUserId, onClose }: MeetingRoomProps) {
  const roomRef=useRef<Room|null>(null);
  const audioRootRef=useRef<HTMLDivElement|null>(null);
  const screenVideoRef=useRef<HTMLVideoElement|null>(null);
  const [credentials,setCredentials]=useState<MeetingJoinCredentials|null>(null);
  const [connected,setConnected]=useState(false);
  const [connecting,setConnecting]=useState(true);
  const [reconnecting,setReconnecting]=useState(false);
  const [microphoneOn,setMicrophoneOn]=useState(false);
  const [screenOn,setScreenOn]=useState(false);
  const [screenTrack,setScreenTrack]=useState<RemoteTrack|LocalTrack|null>(null);
  const [screenOwner,setScreenOwner]=useState('');
  const [participants,setParticipants]=useState<ParticipantRow[]>([]);
  const [sources,setSources]=useState<MeetingDisplaySource[]>([]);
  const [pickerOpen,setPickerOpen]=useState(false);
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');

  const isHost=credentials?.meeting.canHost===true||meeting.canHost===true;

  const refreshParticipants=(room=roomRef.current)=>{
    if(!room){setParticipants([]);return;}
    const rows=[...room.remoteParticipants.values()].map((participant)=>{
      const publications=[...participant.trackPublications.values()];
      const mic=publications.find((publication)=>publication.source===Track.Source.Microphone);
      const screen=publications.some((publication)=>publication.source===Track.Source.ScreenShare);
      return {
        identity:participant.identity,
        name:participant.name||'Uczestnik',
        microphoneTrackSid:mic?.trackSid||null,
        microphoneMuted:mic?.isMuted!==false,
        sharingScreen:screen
      };
    });
    setParticipants(rows);
  };

  const cleanupAudio=()=>{
    if(!audioRootRef.current)return;
    for(const element of [...audioRootRef.current.querySelectorAll('audio')])element.remove();
  };

  useEffect(()=>{
    let cancelled=false;
    const room=new Room({adaptiveStream:true,dynacast:true});
    roomRef.current=room;

    const refresh=()=>refreshParticipants(room);
    const onSubscribed=(track:RemoteTrack, _publication:unknown, participant:{name?:string;identity:string})=>{
      if(track.kind===Track.Kind.Audio){
        const element=track.attach();
        element.autoplay=true;
        element.dataset.meetingAudio='1';
        audioRootRef.current?.appendChild(element);
      }
      if(track.source===Track.Source.ScreenShare){
        setScreenTrack(track);
        setScreenOwner(participant.name||'Uczestnik');
      }
      refresh();
    };
    const onUnsubscribed=(track:RemoteTrack)=>{
      for(const element of track.detach())element.remove();
      if(track.source===Track.Source.ScreenShare)setScreenTrack((current)=>current===track?null:current);
      refresh();
    };

    room.on(RoomEvent.ParticipantConnected,refresh);
    room.on(RoomEvent.ParticipantDisconnected,refresh);
    room.on(RoomEvent.TrackMuted,refresh);
    room.on(RoomEvent.TrackUnmuted,refresh);
    room.on(RoomEvent.ParticipantPermissionsChanged,refresh);
    room.on(RoomEvent.TrackSubscribed,onSubscribed);
    room.on(RoomEvent.TrackUnsubscribed,onUnsubscribed);
    room.on(RoomEvent.Reconnecting,()=>setReconnecting(true));
    room.on(RoomEvent.Reconnected,()=>setReconnecting(false));
    room.on(RoomEvent.Disconnected,()=>{setConnected(false);setReconnecting(false);});

    void (async()=>{
      try{
        const join=await window.lockOn.meetings.join(meeting.id);
        if(cancelled)return;
        setCredentials(join);
        await room.connect(join.serverUrl,join.participantToken,{autoSubscribe:true});
        if(cancelled){room.disconnect();return;}
        // Mikrofon celowo nie jest publikowany automatycznie.
        setMicrophoneOn(false);
        setConnected(true);
        refresh();
      }catch(e){
        if(!cancelled)setError(displayError(e));
      }finally{
        if(!cancelled)setConnecting(false);
      }
    })();

    return()=>{
      cancelled=true;
      try{room.disconnect();}catch{}
      cleanupAudio();
      roomRef.current=null;
    };
  },[meeting.id]);

  useEffect(()=>{
    const video=screenVideoRef.current;
    if(!video||!screenTrack)return;
    screenTrack.attach(video);
    return()=>{try{screenTrack.detach(video);}catch{}};
  },[screenTrack]);

  const toggleMicrophone=async()=>{
    const room=roomRef.current;if(!room||!connected)return;
    setBusy('mic');setError('');
    try{
      const next=!microphoneOn;
      await room.localParticipant.setMicrophoneEnabled(next);
      setMicrophoneOn(next);
    }catch(e){setError(displayError(e));}
    finally{setBusy('');}
  };

  const openScreenPicker=async()=>{
    if(screenOn){
      const room=roomRef.current;if(!room)return;
      setBusy('screen');setError('');
      try{
        await room.localParticipant.setScreenShareEnabled(false);
        setScreenOn(false);setScreenTrack(null);setScreenOwner('');
      }catch(e){setError(displayError(e));}
      finally{setBusy('');}
      return;
    }
    try{
      const list=await window.lockOn.meetings.listDisplaySources();
      setSources(list);
      setPickerOpen(true);
    }catch(e){setError(displayError(e));}
  };

  const startScreenShare=async(source:MeetingDisplaySource)=>{
    const room=roomRef.current;if(!room)return;
    setBusy('screen');setError('');setPickerOpen(false);
    try{
      await window.lockOn.meetings.selectDisplaySource(source.id);
      await room.localParticipant.setScreenShareEnabled(true);
      setScreenOn(true);
      const publication=[...room.localParticipant.trackPublications.values()]
        .find((item)=>item.source===Track.Source.ScreenShare);
      if(publication?.track){
        setScreenTrack(publication.track);
        setScreenOwner('Twój ekran');
      }
    }catch(e){setError(displayError(e));}
    finally{setBusy('');}
  };

  const muteParticipant=async(participant:ParticipantRow)=>{
    if(!participant.microphoneTrackSid)return;
    setBusy('mute:'+participant.identity);setError('');
    try{await window.lockOn.meetings.muteParticipant(meeting.id,participant.identity,participant.microphoneTrackSid);}
    catch(e){setError(displayError(e));}
    finally{setBusy('');}
  };

  const blockParticipantMic=async(participant:ParticipantRow)=>{
    setBusy('block-mic:'+participant.identity);setError('');
    try{
      await window.lockOn.meetings.updateParticipantPermissions(meeting.id,participant.identity,{
        canPublishAudio:false,
        canShareScreen:meeting.allowParticipantScreenShare
      });
    }catch(e){setError(displayError(e));}
    finally{setBusy('');}
  };

  const blockParticipantScreen=async(participant:ParticipantRow)=>{
    setBusy('block-screen:'+participant.identity);setError('');
    try{
      await window.lockOn.meetings.updateParticipantPermissions(meeting.id,participant.identity,{
        canPublishAudio:meeting.allowParticipantAudio,
        canShareScreen:false
      });
    }catch(e){setError(displayError(e));}
    finally{setBusy('');}
  };

  const removeParticipant=async(participant:ParticipantRow)=>{
    setBusy('remove:'+participant.identity);setError('');
    try{await window.lockOn.meetings.removeParticipant(meeting.id,participant.identity);}
    catch(e){setError(displayError(e));}
    finally{setBusy('');}
  };

  const leave=()=>{
    try{roomRef.current?.disconnect();}catch{}
    onClose();
  };

  const participantCount=participants.length+(connected?1:0);
  const remoteScreenOwner=useMemo(()=>screenOwner||'Udostępniany ekran',[screenOwner]);

  return <div className="meeting-room-backdrop">
    <section className="meeting-room" role="dialog" aria-modal="true" aria-label={'Spotkanie: '+meeting.title}>
      <header className="meeting-room-header">
        <div>
          <span className="eyebrow"><span className="meeting-live-dot"/> SPOTKANIE NA ŻYWO</span>
          <h2>{meeting.title}</h2>
          <p>{reconnecting?'Trwa ponowne łączenie…':connected?'Połączono z pokojem audio.':connecting?'Łączenie z pokojem…':'Brak połączenia.'}</p>
        </div>
        <div className="meeting-room-head-actions">
          <span><UsersRound size={14}/>{participantCount}</span>
          {isHost&&<span><Shield size={14}/> Prowadzący</span>}
          <button className="icon-button" onClick={leave} aria-label="Opuść spotkanie"><X size={18}/></button>
        </div>
      </header>

      {error&&<div className="meeting-notice error"><X size={14}/>{error}</div>}

      <div className="meeting-room-layout">
        <main className="meeting-stage">
          {screenTrack ? <div className="meeting-screen">
            <video ref={screenVideoRef} autoPlay playsInline muted={screenOwner==='Twój ekran'}/>
            <span>{remoteScreenOwner}</span>
          </div> : <div className="meeting-screen-empty">
            <MonitorUp size={40}/>
            <strong>Nikt jeszcze nie udostępnia ekranu</strong>
            <span>Prowadzący lub uprawniony uczestnik może wybrać ekran albo okno.</span>
          </div>}

          <div className="meeting-room-controls">
            <button className={'meeting-control '+(microphoneOn?'active':'')} disabled={!connected||busy==='mic'} onClick={()=>void toggleMicrophone()}>
              {microphoneOn?<Mic size={18}/>:<MicOff size={18}/>}
              <span>{microphoneOn?'Wycisz mikrofon':'Włącz mikrofon'}</span>
            </button>
            <button className={'meeting-control '+(screenOn?'active':'')} disabled={!connected||busy==='screen'} onClick={()=>void openScreenPicker()}>
              {screenOn?<MonitorX size={18}/>:<MonitorUp size={18}/>}
              <span>{screenOn?'Zatrzymaj ekran':'Udostępnij ekran'}</span>
            </button>
            <button className="meeting-control danger" onClick={leave}><PhoneOff size={18}/><span>Opuść</span></button>
          </div>
          <small className="meeting-room-privacy">Kamera nie jest używana. Mikrofon jest domyślnie wyciszony przy każdym wejściu.</small>
        </main>

        <aside className="meeting-participants">
          <div className="meeting-participants-head"><strong>Uczestnicy</strong><span>{participantCount}</span></div>
          <article className="meeting-participant me">
            <div className="meeting-avatar">{(credentials?.meeting.hostName||'Ty').slice(0,1).toUpperCase()}</div>
            <div><strong>Ty</strong><small>{microphoneOn?'mikrofon włączony':'mikrofon wyciszony'}{screenOn?' · udostępniasz ekran':''}</small></div>
            {microphoneOn?<Mic size={14}/>:<MicOff size={14}/>}
          </article>
          {participants.map((participant)=><article className="meeting-participant" key={participant.identity}>
            <div className="meeting-avatar">{participant.name.slice(0,1).toUpperCase()}</div>
            <div><strong>{participant.name}</strong><small>{participant.microphoneTrackSid?(participant.microphoneMuted?'wyciszony':'mówi'):'bez mikrofonu'}{participant.sharingScreen?' · udostępnia ekran':''}</small></div>
            {isHost&&participant.identity!==currentUserId?<div className="meeting-moderation">
              <button title="Wycisz mikrofon" disabled={!participant.microphoneTrackSid||Boolean(busy)} onClick={()=>void muteParticipant(participant)}><VolumeX size={13}/></button>
              <button title="Zablokuj mikrofon" disabled={Boolean(busy)} onClick={()=>void blockParticipantMic(participant)}><MicOff size={13}/></button>
              <button title="Zablokuj udostępnianie ekranu" disabled={Boolean(busy)} onClick={()=>void blockParticipantScreen(participant)}><MonitorX size={13}/></button>
              <button title="Usuń uczestnika" disabled={Boolean(busy)} onClick={()=>void removeParticipant(participant)}><UserMinus size={13}/></button>
            </div>:participant.microphoneMuted?<MicOff size={14}/>:<Mic size={14}/>}
          </article>)}
          {connected&&participants.length===0&&<div className="meeting-participants-empty"><RefreshCw size={16}/><span>Czekasz na pozostałych uczestników.</span></div>}
        </aside>
      </div>

      <div ref={audioRootRef} className="meeting-audio-root" aria-hidden="true"/>

      {pickerOpen&&<div className="meeting-source-backdrop">
        <section className="meeting-source-picker" role="dialog" aria-modal="true" aria-label="Wybierz ekran lub okno">
          <header><div><strong>Co chcesz pokazać?</strong><small>Wybierz ekran albo konkretne okno.</small></div><button className="icon-button" onClick={()=>setPickerOpen(false)}><X size={17}/></button></header>
          <div className="meeting-source-grid">
            {sources.map((source)=><button key={source.id} onClick={()=>void startScreenShare(source)}>
              <div>{source.thumbnailDataUrl?<img src={source.thumbnailDataUrl} alt=""/>:<MonitorUp size={32}/>}</div>
              <span>{source.appIconDataUrl&&<img src={source.appIconDataUrl} alt=""/>}<strong>{source.name}</strong></span>
            </button>)}
          </div>
          {sources.length===0&&<div className="meeting-empty"><MonitorUp size={20}/><div><strong>Brak dostępnych ekranów.</strong><span>Sprawdź uprawnienia systemowe do nagrywania ekranu.</span></div></div>}
        </section>
      </div>}
    </section>
  </div>;
}
