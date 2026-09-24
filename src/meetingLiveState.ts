export type MeetingLiveUiState = {
  meetingId:string;
  meetingTitle:string;
  startedAt:string;
  plannedMinutes:number;
  elapsedSeconds:number;
  participantCount:number;
  speakingNames:string[];
  micEnabled:boolean;
  screenEnabled:boolean;
  sourceName:string|null;
  handCount:number;
  latestMessage:{authorName:string;body:string}|null;
};

const EVENT_NAME = 'lockon:meeting-live-state';

export const publishMeetingLiveState = (state: MeetingLiveUiState | null) => {
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail:state }));
};

export const subscribeMeetingLiveState = (callback: (state: MeetingLiveUiState | null) => void) => {
  const listener = (event: Event) => {
    callback((event as CustomEvent<MeetingLiveUiState | null>).detail ?? null);
  };
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
};

export const formatMeetingElapsed = (totalSeconds: number) => {
  const safe = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return hours > 0
    ? [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':')
    : [minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
};
