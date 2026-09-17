import { useEffect, useMemo, useRef, useState } from 'react';
import { Headphones, Send, ShieldCheck, X } from 'lucide-react';
import { type UserRole } from '../config/roles';
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

const STORAGE_KEY = 'lockon-serviceos-help-chat-v2';

const initialMessages: ChatMessage[] = [
  {
    id: 'welcome',
    author: 'system',
    name: 'LockOn ServiceOS',
    text: 'Napisz, z czym masz problem. Ta wersja pomocy zapisuje rozmowę lokalnie na tym urządzeniu.',
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
  const endRef = useRef<HTMLDivElement | null>(null);

  const actualRole = (auth.role ?? 'USER') as UserRole;
  const supportMode = actualRole === 'OWNER' || actualRole === 'SUPPORT';
  const simulatedSupportMode = effectiveRole === 'OWNER' || effectiveRole === 'SUPPORT';

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-80)));
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

  const title = useMemo(
    () => (simulatedSupportMode ? 'Pomoc · tryb wsparcia' : 'Pomoc LockOn'),
    [simulatedSupportMode]
  );

  if (!open) return null;

  const send = () => {
    const value = draft.trim();
    if (!value) return;

    const asSupport = supportMode && simulatedSupportMode;
    setMessages((current) => [
      ...current,
      {
        id: String(Date.now()) + '-' + Math.random().toString(16).slice(2),
        author: asSupport ? 'support' : 'user',
        name: asSupport ? 'Wsparcie LockOn' : (auth.user?.name ?? 'Użytkownik'),
        text: value,
        createdAt: new Date().toISOString()
      }
    ]);
    setDraft('');
  };

  return (
    <>
      <button className="help-chat-backdrop" onClick={onClose} aria-label="Zamknij pomoc" />
      <aside className="help-chat-panel page-enter" aria-label="Pomoc LockOn">
        <header className="help-chat-header">
          <div className="help-chat-icon"><Headphones size={18} /></div>
          <div>
            <strong>{title}</strong>
            <span>{supportMode && simulatedSupportMode ? 'Odpowiadasz jako wsparcie' : 'Rozmowa lokalna na tym urządzeniu'}</span>
          </div>
          <button onClick={onClose} title="Zamknij"><X size={18} /></button>
        </header>

        {simulatedSupportMode && (
          <div className="support-mode-note">
            <ShieldCheck size={15} />
            <div>
              <strong>{supportMode ? 'Tryb wsparcia aktywny' : 'Podgląd trybu wsparcia'}</strong>
              <span>{supportMode ? 'Wiadomość zostanie oznaczona jako odpowiedź wsparcia.' : 'Podgląd nie zmienia Twoich uprawnień.'}</span>
            </div>
          </div>
        )}

        <div className="help-chat-messages">
          {messages.map((message) => (
            <div key={message.id} className={'chat-message chat-' + message.author}>
              <div className="chat-message-meta">
                <span>{message.name}</span>
                <time>{new Date(message.createdAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}</time>
              </div>
              <p>{message.text}</p>
            </div>
          ))}
          <div ref={endRef} />
        </div>

        <footer className="help-chat-compose">
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
              placeholder={supportMode && simulatedSupportMode ? 'Napisz odpowiedź…' : 'Napisz, co nie działa…'}
              rows={2}
            />
            <button className="help-send-button" onClick={send} disabled={!draft.trim()} title="Wyślij">
              <Send size={16} />
            </button>
          </div>
          <small>Enter wysyła · Shift + Enter dodaje nową linię</small>
        </footer>
      </aside>
    </>
  );
}
