import { useEffect, useMemo, useState } from 'react';
import { Headphones, MessageCircleMore, Send, ShieldCheck, X } from 'lucide-react';
import { ROLE_DEFINITIONS, type UserRole } from '../config/roles';
import type { AuthState } from '../types/electron';

interface HelpChatProps {
  open: boolean;
  onClose: () => void;
  auth: AuthState;
  effectiveRole: UserRole;
}

interface ChatMessage {
  id: string;
  author: 'user' | 'support' | 'system';
  name: string;
  text: string;
  createdAt: string;
}

const STORAGE_KEY = 'lockon-serviceos-help-chat-v1';

const initialMessages: ChatMessage[] = [
  {
    id: 'welcome',
    author: 'system',
    name: 'LockOn ServiceOS',
    text: 'Cześć! To panel pomocy. Na tym etapie wiadomości są zapisywane lokalnie na komputerze. W kolejnym etapie podepniemy backend, aby rozmowy działały pomiędzy pracownikami i wsparciem.',
    createdAt: new Date().toISOString()
  }
];

const loadMessages = (): ChatMessage[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialMessages;
    const parsed = JSON.parse(raw) as ChatMessage[];
    return Array.isArray(parsed) && parsed.length ? parsed : initialMessages;
  } catch {
    return initialMessages;
  }
};

export function HelpChat({ open, onClose, auth, effectiveRole }: HelpChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(loadMessages);
  const [draft, setDraft] = useState('');

  const actualRole = (auth.role ?? 'USER') as UserRole;
  const supportMode = actualRole === 'OWNER' || actualRole === 'SUPPORT';
  const simulatedSupportMode = effectiveRole === 'OWNER' || effectiveRole === 'SUPPORT';

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-80)));
  }, [messages]);

  const title = useMemo(
    () => (simulatedSupportMode ? 'Centrum pomocy — tryb obsługi' : 'Pomoc LockOn'),
    [simulatedSupportMode]
  );

  if (!open) return null;

  const send = () => {
    const value = draft.trim();
    if (!value) return;

    const asSupport = supportMode && simulatedSupportMode;
    const message: ChatMessage = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      author: asSupport ? 'support' : 'user',
      name: asSupport ? 'Wsparcie LockOn' : (auth.user?.name ?? 'Użytkownik'),
      text: value,
      createdAt: new Date().toISOString()
    };

    setMessages((current) => [...current, message]);
    setDraft('');
  };

  return (
    <aside className="help-chat-panel page-enter" aria-label="Czat pomocy">
      <header className="help-chat-header">
        <div className="help-chat-icon"><Headphones size={19} /></div>
        <div>
          <strong>{title}</strong>
          <span>{ROLE_DEFINITIONS[effectiveRole].label}</span>
        </div>
        <button onClick={onClose} title="Zamknij"><X size={18} /></button>
      </header>

      {simulatedSupportMode && (
        <div className="support-mode-note">
          <ShieldCheck size={16} />
          <div>
            <strong>{supportMode ? 'Masz uprawnienia obsługi wsparcia' : 'Podgląd roli wsparcia'}</strong>
            <span>{supportMode ? 'Możesz odpowiadać jako Wsparcie LockOn.' : 'To wyłącznie podgląd interfejsu.'}</span>
          </div>
        </div>
      )}

      <div className="help-chat-messages">
        {messages.map((message) => (
          <div key={message.id} className={`chat-message chat-${message.author}`}>
            <div className="chat-message-meta">
              <span>{message.name}</span>
              <time>{new Date(message.createdAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}</time>
            </div>
            <p>{message.text}</p>
          </div>
        ))}
      </div>

      <footer className="help-chat-compose">
        <div className="help-chat-compose-label">
          <MessageCircleMore size={14} />
          <span>{supportMode && simulatedSupportMode ? 'Odpowiedź wsparcia' : 'Napisz wiadomość'}</span>
        </div>
        <div className="help-chat-input-row">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
            placeholder={supportMode && simulatedSupportMode ? 'Odpowiedz użytkownikowi…' : 'Opisz problem lub pytanie…'}
            rows={2}
          />
          <button className="help-send-button" onClick={send} disabled={!draft.trim()} title="Wyślij">
            <Send size={17} />
          </button>
        </div>
        <small>Enter — wyślij • Shift+Enter — nowa linia</small>
      </footer>
    </aside>
  );
}
