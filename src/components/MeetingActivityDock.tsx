import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ChevronDown, Hand, MessageSquare, Radio, Send, UsersRound, X } from 'lucide-react';
import type { MeetingChatMessage, MeetingHandRaise, MeetingSummary } from '../types/electron';
import type { NavigationKey } from './Sidebar';

type Props = {
  activePage: NavigationKey;
  onOpenMeeting: (meetingId: string) => void;
};

const liveMeetingPriority = (meeting: MeetingSummary) => {
  if (meeting.status !== 'LIVE' || !meeting.canManage) return -1;
  return meeting.hostUserId === meeting.createdByUserId ? 2 : 1;
};

export function MeetingActivityDock({ activePage, onOpenMeeting }: Props) {
  const [meeting, setMeeting] = useState<MeetingSummary | null>(null);
  const [messages, setMessages] = useState<MeetingChatMessage[]>([]);
  const [hands, setHands] = useState<MeetingHandRaise[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [seenMessageCount, setSeenMessageCount] = useState(-1);

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      try {
        const payload = await window.lockOn.meetings.list();
        if (disposed) return;
        const next = (payload.meetings ?? [])
          .filter((item) => liveMeetingPriority(item) >= 0)
          .sort((a, b) => liveMeetingPriority(b) - liveMeetingPriority(a))[0] ?? null;
        setMeeting(next);
      } catch {
        if (!disposed) setMeeting(null);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 10_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    setMessages([]);
    setHands([]);
    setExpanded(false);
    setChatInput('');
    setError('');
    setSeenMessageCount(-1);
    if (!meeting) return;

    let disposed = false;
    const load = async () => {
      try {
        const [chat, raisedHands] = await Promise.all([
          window.lockOn.meetings.chat(meeting.id),
          window.lockOn.meetings.hands(meeting.id)
        ]);
        if (disposed) return;
        const nextMessages = chat.messages ?? [];
        setMessages(nextMessages);
        setHands(raisedHands.hands ?? []);
        setSeenMessageCount((current) => current < 0 ? nextMessages.length : Math.min(current, nextMessages.length));
        setError('');
      } catch {
        if (!disposed) setError('Nie udało się odświeżyć aktywności spotkania.');
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 2_200);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [meeting?.id]);

  useEffect(() => {
    if (expanded && messages.length > seenMessageCount) setSeenMessageCount(messages.length);
  }, [expanded, messages.length, seenMessageCount]);

  useEffect(() => {
    if (activePage !== 'browser') return;
    void window.lockOn.browser.setVisible(!expanded).catch(() => undefined);
    return () => { void window.lockOn.browser.setVisible(true).catch(() => undefined); };
  }, [activePage, expanded]);

  const unreadCount = Math.max(0, messages.length - Math.max(0, seenMessageCount));
  const latestMessages = useMemo(() => messages.slice(-4), [messages]);

  const send = async () => {
    const body = chatInput.trim();
    if (!meeting || !body || sending) return;
    setSending(true);
    setError('');
    try {
      const result = await window.lockOn.meetings.sendChat(meeting.id, body.slice(0, 2000));
      setMessages((current) => current.some((item) => item.id === result.message.id) ? current : [...current, result.message]);
      setSeenMessageCount((current) => Math.max(current, messages.length + 1));
      setChatInput('');
    } catch {
      setError('Nie udało się wysłać wiadomości.');
    } finally {
      setSending(false);
    }
  };

  if (!meeting || activePage === 'meetings') return null;

  return (
    <aside className={'meeting-activity-dock ' + (expanded ? 'expanded' : 'compact') + (activePage === 'browser' ? ' on-browser' : '')} aria-live="polite">
      <div className="meeting-activity-dock-head">
        <button
          type="button"
          className="meeting-activity-dock-summary"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          <span className="meeting-activity-live"><Radio size={13} /> TRWA TERAZ</span>
          <span className="meeting-activity-title">{meeting.title}</span>
          <span className="meeting-activity-counters">
            <span title="Nieprzeczytane wiadomości"><MessageSquare size={14} /><b>{unreadCount}</b></span>
            <span title="Podniesione ręce"><Hand size={14} /><b>{hands.length}</b></span>
          </span>
          <ChevronDown size={16} className={expanded ? 'rotated' : ''} />
        </button>
        {expanded && <button type="button" className="meeting-activity-close" onClick={() => setExpanded(false)} aria-label="Zwiń panel spotkania"><X size={15} /></button>}
      </div>

      {expanded && (
        <div className="meeting-activity-dock-body">
          <div className="meeting-activity-dock-section">
            <div className="meeting-activity-section-head">
              <span><MessageSquare size={14} /> Czat</span>
              <small>{messages.length} wiadomości</small>
            </div>
            <div className="meeting-activity-message-list">
              {latestMessages.length === 0 ? (
                <div className="meeting-activity-empty">Brak wiadomości na tym spotkaniu.</div>
              ) : latestMessages.map((message) => (
                <article key={message.id} className={message.mine ? 'mine' : ''}>
                  <div><strong>{message.mine ? 'Ty' : message.authorName}</strong><time>{new Date(message.createdAt).toLocaleTimeString('pl-PL',{hour:'2-digit',minute:'2-digit'})}</time></div>
                  <p>{message.body}</p>
                </article>
              ))}
            </div>
            <div className="meeting-activity-compose">
              <input
                value={chatInput}
                maxLength={2000}
                placeholder="Napisz na czacie…"
                onChange={(event) => setChatInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
              />
              <button type="button" disabled={!chatInput.trim() || sending} onClick={() => void send()} aria-label="Wyślij wiadomość"><Send size={15} /></button>
            </div>
          </div>

          <div className="meeting-activity-dock-section">
            <div className="meeting-activity-section-head">
              <span><Hand size={14} /> Podniesione ręce</span>
              <small>{hands.length}</small>
            </div>
            {hands.length === 0 ? (
              <div className="meeting-activity-empty">Nikt nie czeka na głos.</div>
            ) : (
              <div className="meeting-activity-hand-list">
                {hands.slice(0, 5).map((hand) => (
                  <div key={hand.userId}><b>{hand.position}</b><span>{hand.name}</span><Hand size={13} /></div>
                ))}
                {hands.length > 5 && <small>+{hands.length - 5} kolejnych osób</small>}
              </div>
            )}
          </div>

          {error && <div className="meeting-activity-error">{error}</div>}

          <button type="button" className="meeting-activity-return" onClick={() => onOpenMeeting(meeting.id)}>
            <UsersRound size={15} /> Wróć do spotkania <ArrowRight size={15} />
          </button>
        </div>
      )}
    </aside>
  );
}
