import { useEffect, useRef, useState } from 'react';
import { Bot, Headphones, KeyRound, LoaderCircle, Send, X } from 'lucide-react';
import type { UserRole } from '../config/roles';
import type { AuthState, HelpMessage } from '../types/electron';

interface HelpChatProps {
  open: boolean;
  onClose: () => void;
  auth: AuthState;
  effectiveRole: UserRole;
}

const authorName = (message: HelpMessage, auth: AuthState) => {
  if (message.author === 'assistant') return 'LockOn Pomoc';
  if (message.author === 'support') return 'Wsparcie LockOn';
  if (message.author === 'system') return 'ServiceOS';
  return auth.user?.name ?? 'Użytkownik';
};

export function HelpChat({ open, onClose, auth, effectiveRole }: HelpChatProps) {
  const [messages, setMessages] = useState<HelpMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [consultantRequested, setConsultantRequested] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const canSearchService = ['OWNER', 'BOSS', 'COORDINATOR', 'SUPPORT', 'TECHNICIAN'].includes(effectiveRole);
  const canManageGmail = ['OWNER', 'BOSS', 'COORDINATOR'].includes(effectiveRole);

  const loadConversation = async () => {
    setLoading(true);
    setError('');
    try {
      const conversation = await window.lockOn.assistant.getConversation();
      setMessages(conversation.messages);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się pobrać prywatnej rozmowy.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    void loadConversation();
  }, [open]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !consultantRequested) return;
    const timer=window.setInterval(()=>void loadConversation(),5000);
    return ()=>window.clearInterval(timer);
  }, [open, consultantRequested]);

  if (!open) return null;

  const sendText = async (text: string) => {
    const value = text.trim().slice(0, 1500);
    if (!value || sending) return;
    setSending(true);
    setError('');
    try {
      const result = await window.lockOn.assistant.send(value);
      setMessages((current) => [...current, result.userMessage, result.assistantMessage].slice(-200));
      setDraft('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się wysłać wiadomości.');
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <button className="help-chat-backdrop" onClick={onClose} aria-label="Zamknij pomoc" />
      <aside className="help-chat-panel page-enter" aria-label="Prywatna pomoc LockOn">
        <header className="help-chat-header">
          <div className="help-chat-icon"><Bot size={18} /></div>
          <div>
            <strong>LockOn Pomoc</strong>
            <span>Prywatna rozmowa konta {auth.user?.email}</span>
          </div>
          <button onClick={onClose} title="Zamknij"><X size={18} /></button>
        </header>

        <div className="support-mode-note">
          <KeyRound size={15} />
          <div>
            <strong>Połącz urządzenie mobilne</strong>
            <span>Otwórz app.serviceos.pl na swoim telefonie, zaakceptuj instrukcję pracownika, a tutaj wygeneruj jednorazowy kod. Telefon dostanie dokładnie Twoją rolę i zakres punktów — żadnych dodatkowych uprawnień.</span>
          </div>
          <button className="button small secondary chat-code-button" disabled={sending} onClick={() => void sendText('Wygeneruj kod do strony')}>
            Połącz urządzenie
          </button>
        </div>

        <div className="help-chat-quick-actions" aria-label="Szybkie akcje pomocy">
          {canSearchService && <button onClick={() => setDraft('znajdź klienta ')}>Znajdź klienta</button>}
          {canSearchService && <button onClick={() => setDraft('zlecenie ')}>Sprawdź zlecenie</button>}
          {canSearchService && <button onClick={() => setDraft('historia klienta ')}>Historia klienta</button>}
          {canManageGmail && <button onClick={() => void sendText('Jak działają powiadomienia Gmail?')}>Gmail</button>}
          <button onClick={() => void sendText('Jakie są moje uprawnienia?')}>Moje uprawnienia</button>
          <button onClick={async () => { try { await window.lockOn.support.request(auth.point?.id); setConsultantRequested(true); await loadConversation(); } catch(e){ setError(e instanceof Error?e.message:'Nie udało się poprosić konsultanta.'); } }}><Headphones size={13}/> Poproś konsultanta o pomoc</button>
        </div>

        <div className="help-chat-messages">
          {loading && (
            <div className="chat-message chat-system">
              <div className="chat-message-meta"><span>ServiceOS</span></div>
              <p><LoaderCircle className="spin" size={14} /> Ładowanie prywatnej rozmowy…</p>
            </div>
          )}
          {!loading && messages.length === 0 && (
            <div className="chat-message chat-assistant">
              <div className="chat-message-meta"><span>LockOn Pomoc</span></div>
              <p>Cześć. Możesz pytać o ServiceOS, wyszukać klienta, sprawdzić zlecenie albo połączyć swój telefon z panelem WWW jednorazowym kodem.</p>
            </div>
          )}
          {messages.map((message) => (
            <div key={message.id} className={'chat-message chat-' + message.author}>
              <div className="chat-message-meta">
                <span>{authorName(message, auth)}</span>
                <time>{new Date(message.createdAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}</time>
              </div>
              <p>{message.text}</p>
            </div>
          ))}
          {error && <div className="chat-message chat-system"><p>{error}</p></div>}
          <div ref={endRef} />
        </div>

        <footer className="help-chat-compose">
          <div className="help-chat-input-row">
            <textarea
              value={draft}
              maxLength={1500}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void sendText(draft);
                }
              }}
              placeholder='Np. "historia klienta Kowalski", "zlecenie 123 statusy" albo "jak działa aktualizacja?"'
              rows={2}
            />
            <button className="help-send-button" onClick={() => void sendText(draft)} disabled={!draft.trim() || sending} title="Wyślij">
              {sending ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}
            </button>
          </div>
          <small>Rozmowa jest przypisana do Twojego konta. Asystent nie omija uprawnień punktów i ról.</small>
        </footer>
      </aside>
    </>
  );
}
