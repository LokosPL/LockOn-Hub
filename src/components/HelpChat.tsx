import { useEffect, useRef, useState } from 'react';
import { Activity, Bot, ExternalLink, Gauge, Headphones, KeyRound, LoaderCircle, Send, UserRoundCheck, Wifi, X } from 'lucide-react';
import type { UserRole } from '../config/roles';
import type { AuthState, HelpAction, HelpConversation, HelpMessage } from '../types/electron';

interface HelpChatProps {
  open: boolean;
  onClose: () => void;
  auth: AuthState;
  effectiveRole: UserRole;
  onAction: (action: HelpAction) => void;
}

const authorName = (message: HelpMessage, auth: AuthState) => {
  if (message.author === 'assistant') return 'LockOn Pomoc';
  if (message.author === 'support') return 'Wsparcie LockOn';
  if (message.author === 'system') return 'ServiceOS';
  return auth.user?.name ?? 'Użytkownik';
};

const emptyConversation: HelpConversation = {
  id: '',
  status: 'OPEN',
  consultantState: 'BOT',
  consultantRequestedAt: null,
  consultantJoinedAt: null,
  assignedSupportUserId: null,
  assignedSupportName: null,
  messages: []
};

export function HelpChat({ open, onClose, auth, effectiveRole, onAction }: HelpChatProps) {
  const [conversation, setConversation] = useState<HelpConversation>(emptyConversation);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [requestingConsultant, setRequestingConsultant] = useState(false);
  const [error, setError] = useState('');
  const [toolBusy, setToolBusy] = useState(false);
  const [toolResult, setToolResult] = useState<{title:string;lines:string[];kind:'speed'|'diag'} | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const canSearchService = ['OWNER', 'BOSS', 'COORDINATOR', 'SUPPORT', 'TECHNICIAN'].includes(effectiveRole);
  const canManageGmail = ['OWNER', 'BOSS', 'COORDINATOR'].includes(effectiveRole);

  const loadConversation = async (silent = false) => {
    if (!silent) setLoading(true);
    if (!silent) setError('');
    try {
      const result = await window.lockOn.assistant.getConversation();
      setConversation(result);
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : 'Nie udało się pobrać prywatnej rozmowy.');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    void loadConversation();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadConversation(true);
    }, conversation.consultantState === 'WAITING' || conversation.consultantState === 'JOINED' ? 3500 : 7000);
    return () => window.clearInterval(timer);
  }, [open, conversation.consultantState]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [conversation.messages, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const runLocalTool = async (action: HelpAction) => {
    if (!['SPEED_TEST','CONNECTIVITY_TEST'].includes(action.type) || toolBusy) return;
    setToolBusy(true);
    setToolResult(null);
    setError('');
    try {
      if (action.type === 'SPEED_TEST') {
        const result = await window.lockOn.diagnostics.internetSpeed();
        setToolResult({
          kind:'speed',
          title:'Wynik testu internetu',
          lines:[
            `Pobieranie: ${result.downloadMbps.toFixed(1)} Mb/s`,
            `Wysyłanie: ${result.uploadMbps == null ? 'nie udało się zmierzyć' : result.uploadMbps.toFixed(1)+' Mb/s'}`,
            `Opóźnienie: ${result.latencyMs} ms`,
            `Ocena łącza: ${result.quality}`,
            ...(result.warning ? [result.warning] : [])
          ]
        });
      } else {
        const result = await window.lockOn.diagnostics.connectivity();
        setToolResult({
          kind:'diag',
          title:'Diagnostyka ServiceOS',
          lines:[
            `Internet: ${result.internetOk ? 'działa' : 'brak odpowiedzi'}${result.internetLatencyMs == null ? '' : ' · '+result.internetLatencyMs+' ms'}`,
            `Centralne API: ${result.apiOk ? 'działa' : 'problem'}${result.apiLatencyMs == null ? '' : ' · '+result.apiLatencyMs+' ms'}`,
            `Aplikacja: v${result.version} · ${result.platform}`,
            ...(result.apiError ? ['API: '+result.apiError] : [])
          ]
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się wykonać diagnostyki.');
    } finally {
      setToolBusy(false);
      window.setTimeout(() => endRef.current?.scrollIntoView({behavior:'smooth',block:'end'}), 50);
    }
  };

  const sendText = async (text: string) => {
    const value = text.trim().slice(0, 1500);
    if (!value || sending) return;
    setSending(true);
    setError('');
    try {
      const result = await window.lockOn.assistant.send(value);
      setConversation((current) => ({
        ...current,
        consultantState: result.consultantState ?? current.consultantState,
        messages: [
          ...current.messages,
          result.userMessage,
          ...(result.assistantMessage ? [result.assistantMessage] : [])
        ].slice(-200)
      }));
      setDraft('');
      if (result.action && ['SPEED_TEST','CONNECTIVITY_TEST'].includes(result.action.type)) {
        void runLocalTool(result.action);
      }
      window.setTimeout(() => void loadConversation(true), 500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się wysłać wiadomości.');
    } finally {
      setSending(false);
    }
  };

  const requestConsultant = async () => {
    if (requestingConsultant || conversation.consultantState === 'JOINED') return;
    setRequestingConsultant(true);
    setError('');
    try {
      await window.lockOn.support.request(auth.point?.id, 'Proszę konsultanta o dołączenie do tej rozmowy.');
      await loadConversation(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się poprosić konsultanta.');
    } finally {
      setRequestingConsultant(false);
    }
  };

  const state = conversation.consultantState ?? 'BOT';
  const statusCopy = state === 'JOINED'
    ? {
        title: (conversation.assignedSupportName || 'Konsultant') + ' jest w rozmowie',
        text: 'Twoje kolejne wiadomości trafiają bezpośrednio do konsultanta. Bot nie odpowiada automatycznie.',
        className: 'joined'
      }
    : state === 'WAITING'
      ? {
          title: 'Czekasz na konsultanta',
          text: 'Możesz nadal pytać bota. Gdy konsultant dołączy, zobaczysz to tutaj bez otwierania nowej rozmowy.',
          className: 'waiting'
        }
      : {
          title: 'Najpierw pomaga bot ServiceOS',
          text: 'Bot zna działanie aplikacji i może otwierać właściwe zlecenia oraz moduły. Człowieka możesz poprosić w dowolnej chwili.',
          className: 'bot'
        };

  const renderAction = (action?: HelpAction | null) => {
    if (!action || action.type === 'WEBSITE_CODE') return null;
    const localTool = action.type === 'SPEED_TEST' || action.type === 'CONNECTIVITY_TEST';
    return (
      <button
        className="chat-message-action"
        type="button"
        disabled={localTool && toolBusy}
        onClick={() => localTool ? void runLocalTool(action) : onAction(action)}
      >
        {action.type === 'SPEED_TEST' ? <Gauge size={13}/> : action.type === 'CONNECTIVITY_TEST' ? <Activity size={13}/> : <ExternalLink size={13}/>}
        {localTool && toolBusy ? 'Trwa pomiar…' : (action.label || 'Otwórz w ServiceOS')}
      </button>
    );
  };

  return (
    <>
      <button className="help-chat-backdrop" onClick={onClose} aria-label="Zamknij pomoc" />
      <aside className="help-chat-panel page-enter" aria-label="Prywatna pomoc LockOn">
        <header className="help-chat-header">
          <div className="help-chat-icon"><Bot size={18} /></div>
          <div>
            <strong>LockOn Pomoc</strong>
            <span>Prywatna rozmowa · {auth.user?.email}</span>
          </div>
          <button onClick={onClose} title="Zamknij"><X size={18} /></button>
        </header>

        <div className={'consultant-state-card ' + statusCopy.className}>
          <div>{state === 'JOINED' ? <UserRoundCheck size={17}/> : state === 'WAITING' ? <Headphones size={17}/> : <Bot size={17}/>}</div>
          <span><strong>{statusCopy.title}</strong><small>{statusCopy.text}</small></span>
          {state !== 'JOINED' && (
            <button type="button" disabled={requestingConsultant || state === 'WAITING'} onClick={() => void requestConsultant()}>
              {requestingConsultant ? 'Wysyłam…' : state === 'WAITING' ? 'Prośba wysłana' : 'Poproś konsultanta'}
            </button>
          )}
        </div>

        <div className="support-mode-note">
          <KeyRound size={15} />
          <div>
            <strong>Połącz telefon z ServiceOS</strong>
            <span>Jednorazowy kod przeniesie na telefon dokładnie Twoją rolę, przypisane punkty i dodatkowe uprawnienia.</span>
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
          <button onClick={() => void sendText('Jak działają przekazania urządzeń?')}>Przekazania</button>
        </div>

        <div className="help-chat-messages">
          {loading && (
            <div className="chat-message chat-system">
              <div className="chat-message-meta"><span>ServiceOS</span></div>
              <p><LoaderCircle className="spin" size={14} /> Ładowanie rozmowy…</p>
            </div>
          )}
          {!loading && conversation.messages.length === 0 && (
            <div className="chat-message chat-assistant">
              <div className="chat-message-meta"><span>LockOn Pomoc</span></div>
              <p>Cześć. Napisz, czego szukasz. Mogę sprawdzić zlecenie, klienta, wyjaśnić proces albo przenieść Cię do właściwego miejsca w ServiceOS.</p>
            </div>
          )}
          {conversation.messages.map((message) => (
            <div key={message.id} className={'chat-message chat-' + message.author}>
              <div className="chat-message-meta">
                <span>{authorName(message, auth)}</span>
                <time>{new Date(message.createdAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}</time>
              </div>
              <p>{message.text}</p>
              {renderAction(message.action)}
            </div>
          ))}
          {toolResult && (
            <div className={'chat-tool-result '+toolResult.kind}>
              <div>{toolResult.kind === 'speed' ? <Wifi size={16}/> : <Activity size={16}/>}</div>
              <span><strong>{toolResult.title}</strong>{toolResult.lines.map((line,index)=><small key={index}>{line}</small>)}</span>
            </div>
          )}
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
              placeholder={state === 'JOINED'
                ? 'Napisz do konsultanta…'
                : 'Np. „zlecenie 123 statusy”, „gdzie jest telefon?” albo „jak zablokować konto?”'}
              rows={2}
            />
            <button className="help-send-button" onClick={() => void sendText(draft)} disabled={!draft.trim() || sending} title="Wyślij">
              {sending ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}
            </button>
          </div>
          <small>Rozmowa należy do Twojego konta. Konsultant widzi ją dopiero po Twojej prośbie o dołączenie.</small>
        </footer>
      </aside>
    </>
  );
}
