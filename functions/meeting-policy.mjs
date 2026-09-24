const VALID_STATUSES = new Set(['SCHEDULED','LIVE','ENDED','CANCELLED']);

export const normalizeMeetingStatus = (status) => {
  const value = String(status || '').toUpperCase();
  return VALID_STATUSES.has(value) ? value : 'SCHEDULED';
};

export const canJoinMeeting = (status) => normalizeMeetingStatus(status) === 'LIVE';

export const getMeetingTransition = (status, action) => {
  const current = normalizeMeetingStatus(status);
  const normalizedAction = String(action || '').toLowerCase();
  const transitions = {
    start: { from:['SCHEDULED'], to:'LIVE' },
    end: { from:['LIVE'], to:'ENDED' },
    cancel: { from:['SCHEDULED','LIVE'], to:'CANCELLED' }
  };
  const transition = transitions[normalizedAction];
  if (!transition || !transition.from.includes(current)) return null;
  return transition.to;
};

export const meetingScheduleHint = (status, startsAt, nowMs = Date.now()) => {
  if (normalizeMeetingStatus(status) !== 'SCHEDULED') return '';
  const startsMs = new Date(startsAt).getTime();
  if (!Number.isFinite(startsMs)) return '';
  const diff = startsMs - nowMs;
  if (diff <= 0) return 'Termin minął · oczekiwanie na prowadzącego';
  const minutes = Math.ceil(diff / 60_000);
  if (minutes < 60) return 'Za ' + minutes + ' min';
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return 'Za ' + hours + ' godz.';
  const date = new Date(startsMs);
  const today = new Date(nowMs);
  if (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  ) return 'Dzisiaj ' + date.toLocaleTimeString('pl-PL',{hour:'2-digit',minute:'2-digit'});
  return '';
};

export const resolveMeetingPublishPermissions = ({
  isManager = false,
  allowParticipantAudio = false,
  allowParticipantScreenShare = false,
  microphoneAllowed = null
} = {}) => {
  if (isManager) return { microphone:true, screenShare:true };
  const microphone = microphoneAllowed === true || (microphoneAllowed !== false && allowParticipantAudio === true);
  return { microphone, screenShare:allowParticipantScreenShare === true };
};

export const buildLiveKitGrant = (room, publishSources = []) => ({
  roomJoin:true,
  room:String(room),
  canSubscribe:true,
  canPublish:publishSources.length > 0,
  canPublishData:false,
  canPublishSources:[...publishSources]
});

export const normalizeLiveKitUrls = (rawValue) => {
  const raw = String(rawValue || '').trim().replace(/\/$/,'');
  if (!raw) return null;
  let parsed;
  try { parsed = new URL(raw); }
  catch { throw new Error('LIVEKIT_URL musi być prawidłowym adresem URL.'); }

  const localHost = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
  if (!['wss:','https:','ws:','http:'].includes(parsed.protocol)) {
    throw new Error('LIVEKIT_URL musi używać wss:// albo https://.');
  }
  if (['ws:','http:'].includes(parsed.protocol) && !localHost) {
    throw new Error('LIVEKIT_URL poza localhost musi używać szyfrowanego wss:// albo https://.');
  }
  if ((parsed.pathname && parsed.pathname !== '/') || parsed.search || parsed.hash) {
    throw new Error('LIVEKIT_URL nie może zawierać ścieżki, query ani fragmentu.');
  }

  const secure = parsed.protocol === 'wss:' || parsed.protocol === 'https:';
  const clientProtocol = secure ? 'wss:' : 'ws:';
  const serverProtocol = secure ? 'https:' : 'http:';
  const base = '//' + parsed.host;
  return {
    clientUrl:clientProtocol + base,
    serverUrl:serverProtocol + base,
    hostname:parsed.hostname,
    isCloud:parsed.hostname.endsWith('.livekit.cloud'),
    secure
  };
};
