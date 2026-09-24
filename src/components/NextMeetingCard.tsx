import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CalendarDays, Clock3, GraduationCap, Hand, History, MessageSquare, Radio, UsersRound } from 'lucide-react';
import type { MeetingChatMessage, MeetingHandRaise, MeetingSummary } from '../types/electron';

type Props = {
  onOpen: () => void;
  onOpenMeeting: (meetingId: string) => void;
};

export function NextMeetingCard({ onOpen, onOpenMeeting }: Props) {
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [chat, setChat] = useState<MeetingChatMessage[]>([]);
  const [hands, setHands] = useState<MeetingHandRaise[]>([]);

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

  const meeting = useMemo(() => meetings
    .filter((item) => item.status === 'SCHEDULED' || (item.status === 'LIVE' && (item.canManage || item.registeredByMe)))
    .sort((a, b) => a.status === b.status
      ? new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
      : a.status === 'LIVE' ? -1 : 1)[0] ?? null, [meetings]);

  useEffect(() => {
    setChat([]);
    setHands([]);
    if (!meeting || meeting.status !== 'LIVE' || (!meeting.canManage && !meeting.registeredByMe)) return;
    let active = true;
    const load = async () => {
      try {
        const [chatData, handData] = await Promise.all([
          window.lockOn.meetings.chat(meeting.id),
          window.lockOn.meetings.hands(meeting.id)
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
  }, [meeting?.id, meeting?.status, meeting?.canManage, meeting?.registeredByMe]);

  const date = meeting ? new Date(meeting.startsAt) : null;
  const canEnterLive = Boolean(meeting?.status === 'LIVE' && (meeting.canManage || meeting.registeredByMe));

  return (
    <section className="start-meeting-hub" aria-label="Spotkania i szkolenia">
      <div className="start-meeting-showcase">
        <div className="start-meeting-copy">
          <span className="start-meeting-eyebrow"><CalendarDays size={15} /> SPOTKANIA I SZKOLENIA</span>
          <h2>Zarządzaj spotkaniami i szkoleniami</h2>
          <p>Terminy, zapisy, prowadzenie spotkania, czat i frekwencję masz w jednym uporządkowanym module.</p>
          <button className="button primary start-meeting-open" type="button" onClick={onOpen}>
            <CalendarDays size={16} /> Otwórz spotkania <ArrowRight size={16} />
          </button>
        </div>

        <div className="start-meeting-visual" aria-hidden="true">
          <div className="start-meeting-calendar-art">
            <span /><span /><span /><span /><span /><span />
          </div>
        </div>

        <div className="start-meeting-actions">
          <button type="button" onClick={onOpen}>
            <span><CalendarDays size={18} /></span>
            <div><strong>Zarządzaj spotkaniami</strong><small>Twórz, edytuj i dołączaj.</small></div>
            <ArrowRight size={15} />
          </button>
          <button type="button" onClick={onOpen}>
            <span><History size={18} /></span>
            <div><strong>Oglądaj historię</strong><small>Sprawdź wcześniejsze spotkania.</small></div>
            <ArrowRight size={15} />
          </button>
          <button type="button" onClick={onOpen}>
            <span><GraduationCap size={18} /></span>
            <div><strong>Planuj szkolenia</strong><small>Przygotuj szkolenie dla zespołu.</small></div>
            <ArrowRight size={15} />
          </button>
        </div>
      </div>

      <aside className={'start-active-meeting ' + (meeting?.status === 'LIVE' ? 'live' : '')}>
        <div className="start-active-meeting-head">
          <span>{meeting?.status === 'LIVE' ? <><Radio size={13} /> AKTYWNE SPOTKANIE</> : 'NAJBLIŻSZE SPOTKANIE'}</span>
          {meeting?.status === 'LIVE' && <b>Trwa teraz</b>}
        </div>

        {!meeting ? (
          <div className="start-active-meeting-empty">
            <div className="start-active-meeting-empty-icon"><UsersRound size={24} /></div>
            <strong>Brak aktywnego spotkania</strong>
            <span>Gdy pojawi się spotkanie, zobaczysz tutaj najważniejsze informacje.</span>
          </div>
        ) : (
          <>
            <div className="start-active-meeting-title">
              <div className="start-active-meeting-icon"><UsersRound size={20} /></div>
              <div>
                <strong>{meeting.title}</strong>
                <span>{date?.toLocaleDateString('pl-PL',{day:'2-digit',month:'short'})} · {date?.toLocaleTimeString('pl-PL',{hour:'2-digit',minute:'2-digit'})}</span>
              </div>
            </div>

            {meeting.status === 'LIVE' ? (
              <>
                <div className="start-active-meeting-signals">
                  <div><MessageSquare size={17} /><span><b>{chat.length}</b> wiadomości</span></div>
                  <div><Hand size={17} /><span><b>{hands.length}</b> podniesione ręce</span></div>
                </div>
                {hands.length > 0 && (
                  <div className="start-active-hand-preview">
                    <Hand size={13} />
                    <span>{hands.slice(0,2).map((item) => item.name).join(', ')}{hands.length > 2 ? ` +${hands.length - 2}` : ''}</span>
                  </div>
                )}
                <button
                  className="button primary start-active-meeting-return"
                  type="button"
                  disabled={!canEnterLive}
                  onClick={() => onOpenMeeting(meeting.id)}
                >
                  Wróć do spotkania <ArrowRight size={16} />
                </button>
              </>
            ) : (
              <>
                <div className="start-active-meeting-scheduled">
                  <Clock3 size={16} />
                  <div><strong>{meeting.hostName}</strong><span>{meeting.registeredCount}/{meeting.maxParticipants} zapisanych</span></div>
                </div>
                <button className="button secondary start-active-meeting-return" type="button" onClick={onOpen}>
                  Zobacz szczegóły <ArrowRight size={16} />
                </button>
              </>
            )}
          </>
        )}
      </aside>
    </section>
  );
}
