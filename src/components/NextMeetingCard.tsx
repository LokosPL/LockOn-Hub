import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CalendarDays, Clock3, GraduationCap, Hand, MessageSquare, Radio, UsersRound } from 'lucide-react';
import type { MeetingChatMessage, MeetingHandRaise, MeetingSummary } from '../types/electron';
import type { UserRole } from '../config/roles';

type Props = {
  onOpen: () => void;
  onOpenMeeting: (meetingId: string) => void;
  role: UserRole;
};

const isTraining = (meeting: MeetingSummary) =>
  /(^|\s)(szkoleni|szkolenie|szkolenia|warsztat|warsztaty|training)(\s|$)/i
    .test((meeting.title + ' ' + meeting.description).trim());

const formatMeetingDate = (meeting: MeetingSummary) => {
  const date = new Date(meeting.startsAt);
  return date.toLocaleString('pl-PL', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
};

export function NextMeetingCard({ onOpen, onOpenMeeting, role }: Props) {
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [chat, setChat] = useState<MeetingChatMessage[]>([]);
  const [hands, setHands] = useState<MeetingHandRaise[]>([]);

  const canManage = role === 'OWNER' || role === 'BOSS' || role === 'COORDINATOR';

  useEffect(() => {
    let active = true;
    const load = () => void window.lockOn.meetings.list()
      .then((data) => { if (active) setMeetings(data.meetings ?? []); })
      .catch(() => undefined);
    load();
    const timer = window.setInterval(load, 20_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const liveMeeting = useMemo(() => meetings
    .filter((item) => item.status === 'LIVE' && (item.canManage || item.registeredByMe))
    .sort((a, b) => new Date(a.startedAt || a.startsAt).getTime() - new Date(b.startedAt || b.startsAt).getTime())[0] ?? null, [meetings]);

  const upcomingMeeting = useMemo(() => meetings
    .filter((item) => item.status === 'SCHEDULED' && !isTraining(item))
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())[0] ?? null, [meetings]);

  const training = useMemo(() => meetings
    .filter((item) => item.status === 'SCHEDULED' && isTraining(item))
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())[0] ?? null, [meetings]);

  const meeting = liveMeeting ?? upcomingMeeting;

  useEffect(() => {
    setChat([]);
    setHands([]);
    if (!liveMeeting) return;
    let active = true;
    const load = async () => {
      try {
        const [chatData, handData] = await Promise.all([
          window.lockOn.meetings.chat(liveMeeting.id),
          window.lockOn.meetings.hands(liveMeeting.id)
        ]);
        if (!active) return;
        setChat(chatData.messages ?? []);
        setHands(handData.hands ?? []);
      } catch {}
    };
    void load();
    const timer = window.setInterval(() => void load(), 3_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [liveMeeting?.id]);

  return (
    <section className="start-meeting-hub start-meeting-hub-unified" aria-label="Spotkania i szkolenia">
      <header className="start-meeting-unified-head">
        <div>
          <span className="start-meeting-eyebrow"><CalendarDays size={15} /> SPOTKANIA I SZKOLENIA</span>
          <h2>Spotkania i szkolenia</h2>
          <p>Najbliższe szkolenia i aktywne spotkanie w jednym spokojnym widoku.</p>
        </div>
        <button className="button secondary start-meeting-module-button" type="button" onClick={onOpen}>
          <CalendarDays size={16} /> {canManage ? 'Zarządzaj' : 'Zobacz spotkania'} <ArrowRight size={15} />
        </button>
      </header>

      <div className="start-meeting-unified-grid">
        <article className="start-training-card">
          <div className="start-training-card-head">
            <span><GraduationCap size={17} /> Twoje szkolenia</span>
            {training && <b>Zaplanowane</b>}
          </div>

          {training ? (
            <button type="button" className="start-training-upcoming" onClick={onOpen}>
              <div className="start-training-icon"><GraduationCap size={25} /></div>
              <div>
                <strong>{training.title}</strong>
                <span><Clock3 size={13} /> {formatMeetingDate(training)}</span>
                {training.description && <p>{training.description}</p>}
              </div>
              <ArrowRight size={16} />
            </button>
          ) : (
            <div className="start-training-empty">
              <div className="start-training-orbit" aria-hidden="true">
                <GraduationCap size={34} />
                <i /><i /><i />
              </div>
              <strong>Brak zaplanowanych szkoleń</strong>
              <span>Gdy pojawi się nowe szkolenie dostępne dla Ciebie, zobaczysz je właśnie tutaj.</span>
            </div>
          )}
        </article>

        <article className={'start-meeting-focus-card ' + (liveMeeting ? 'live' : '')}>
          <div className="start-meeting-focus-head">
            <span>{liveMeeting ? <><Radio size={14} /> Aktywne spotkanie</> : <><UsersRound size={14} /> Najbliższe spotkanie</>}</span>
            {liveMeeting && <b>Trwa teraz</b>}
          </div>

          {!meeting ? (
            <div className="start-meeting-focus-empty">
              <div className="start-meeting-focus-icon"><UsersRound size={24} /></div>
              <strong>Brak aktywnego spotkania</strong>
              <span>Nie masz teraz spotkania wymagającego uwagi.</span>
            </div>
          ) : (
            <>
              <div className="start-meeting-focus-title">
                <div className="start-meeting-focus-icon"><UsersRound size={21} /></div>
                <div>
                  <strong>{meeting.title}</strong>
                  <span>{formatMeetingDate(meeting)}</span>
                </div>
              </div>

              {liveMeeting ? (
                <>
                  <div className="start-meeting-focus-signals">
                    <div><MessageSquare size={17} /><span><b>{chat.length}</b> wiadomości</span></div>
                    <div><Hand size={17} /><span><b>{hands.length}</b> {hands.length === 1 ? 'podniesiona ręka' : 'podniesione ręce'}</span></div>
                  </div>
                  {hands.length > 0 && (
                    <div className="start-meeting-focus-hand-preview">
                      <Hand size={13} />
                      <span>{hands.slice(0, 2).map((item) => item.name).join(', ')}{hands.length > 2 ? ` +${hands.length - 2}` : ''}</span>
                    </div>
                  )}
                  <button className="button primary start-meeting-focus-return" type="button" onClick={() => onOpenMeeting(liveMeeting.id)}>
                    Wróć do spotkania <ArrowRight size={16} />
                  </button>
                </>
              ) : (
                <button className="button secondary start-meeting-focus-return" type="button" onClick={onOpen}>
                  Zobacz szczegóły <ArrowRight size={16} />
                </button>
              )}
            </>
          )}
        </article>
      </div>
    </section>
  );
}
