import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Headphones, Send, ShieldCheck, Sparkles, X } from 'lucide-react';
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
  author: 'user' | 'support' | 'system' | 'assistant';
  name: string;
  text: string;
  createdAt: string;
}

interface HelpAnswer {
  keywords: string[];
  answer: string;
}

const STORAGE_KEY = 'lockon-serviceos-help-chat-v3';

const HELP_ANSWERS: HelpAnswer[] = [
  { keywords:['zalog','google'], answer:'Logowanie Google otwiera bezpieczne okno systemowej przeglądarki. Wybierz konto Google i wróć do ServiceOS po potwierdzeniu.' },
  { keywords:['wylog'], answer:'Wylogowanie znajdziesz przy swoim profilu w lewym dolnym rogu. ServiceOS usuwa lokalną sesję i unieważnia ją w API.' },
  { keywords:['konto','oczek','akcept'], answer:'Nowe konto po logowaniu czeka na zatwierdzenie. Właściciel przypisuje rolę i punkt w module Administracja.' },
  { keywords:['punkt','zgłos'], answer:'Na ekranie oczekiwania wpisz nazwę punktu i miasto. To jest prośba — właściwe przypisanie zatwierdza właściciel.' },
  { keywords:['rola','uprawn'], answer:'Role ograniczają moduły i punkty dostępne dla użytkownika. Faktyczne uprawnienia sprawdza backend, nie sam wygląd aplikacji.' },
  { keywords:['właściciel','owner'], answer:'Właściciel ma globalny zakres, administrację, podgląd ról i zarządzanie aktualizacjami.' },
  { keywords:['szef','boss'], answer:'Szef ma globalny wgląd operacyjny w punkty, naprawy i rozliczenia, bez technicznych ustawień właściciela.' },
  { keywords:['koordynator'], answer:'Koordynator pracuje na przypisanych punktach i widzi funkcje wynikające z tej roli.' },
  { keywords:['serwisant','technik'], answer:'Serwisant pracuje na przypisanych punktach, obsługuje naprawy i może wprowadzać własne rozliczenia.' },
  { keywords:['wsparcie','support'], answer:'Wsparcie LockOnOS ma dostęp do obsługi pomocy dla przypisanych punktów. Podgląd roli właściciela nie zmienia prawdziwych uprawnień.' },
  { keywords:['użytkownik','user'], answer:'Użytkownik ma podstawowy dostęp do przypisanego punktu.' },
  { keywords:['podgląd','roli'], answer:'Właściciel może podejrzeć aplikację jak inna rola. Pasek u góry przypomina, że to tylko podgląd — uprawnienia konta pozostają OWNER.' },
  { keywords:['administr'], answer:'Administracja służy do obsługi zgłoszeń użytkowników, punktów, ról i dostępu. Operacje administracyjne są dodatkowo kontrolowane przez API.' },
  { keywords:['przychód','rozlicz'], answer:'Przychód wpisuje uprawniony użytkownik, a zatwierdzenie wykonuje Szef lub Właściciel. Obecny podział Szef/Serwisant to 50/50.' },
  { keywords:['50','50'], answer:'W aktualnym modelu zatwierdzone rozliczenie jest dzielone 50/50 między Szefa i Serwisanta.' },
  { keywords:['odrzu','przych'], answer:'Odrzucone rozliczenie nie powinno być traktowane jako zatwierdzony przychód. Szczegóły zobaczysz w module Rozliczenia.' },
  { keywords:['przegląd'], answer:'Wbudowana przeglądarka działa w osobnej, izolowanej sesji bez Node.js i bez dostępu do API aplikacji.' },
  { keywords:['pobier','plik','przegląd'], answer:'Dla bezpieczeństwa wbudowana przeglądarka blokuje automatyczne pobieranie plików. Potrzebną stronę możesz otworzyć w domyślnej przeglądarce systemowej.' },
  { keywords:['kamera'], answer:'ServiceOS domyślnie odmawia stronom dostępu do kamery, mikrofonu, lokalizacji i innych uprawnień przeglądarki.' },
  { keywords:['mikrofon'], answer:'ServiceOS domyślnie blokuje uprawnienie mikrofonu dla stron otwieranych w aplikacji.' },
  { keywords:['lokaliz'], answer:'Strony w osadzonej przeglądarce nie otrzymują automatycznie dostępu do lokalizacji.' },
  { keywords:['http','https'], answer:'Zewnętrzne strony powinny działać przez HTTPS. ServiceOS dopuszcza zwykłe HTTP tylko dla lokalnego hosta deweloperskiego.' },
  { keywords:['aktualiz'], answer:'Aktualizacje są sprawdzane przez GitHub Releases. Zarządzanie aktualizacjami jest funkcją właściciela.' },
  { keywords:['wersj'], answer:'Numer zainstalowanej wersji znajdziesz w ustawieniach/sekcji aktualizacji. Strona pobierania pokazuje najnowsze wydanie GitHub.' },
  { keywords:['instalator'], answer:'Oficjalny instalator powinien pochodzić z GitHub Release projektu LockOn ServiceOS, nie z przypadkowych linków.' },
  { keywords:['sha','hash','suma'], answer:'SHA-256 pozwala sprawdzić integralność instalatora. Strona pobierania pokazuje hash, gdy GitHub udostępnia go w metadanych wydania.' },
  { keywords:['bezpiecz'], answer:'ServiceOS używa sandboxa Electron, izolacji kontekstu, ograniczonego IPC, CSP, kontroli nawigacji oraz sesji weryfikowanych przez backend.' },
  { keywords:['sesj'], answer:'Token sesji aplikacji jest przechowywany lokalnie z użyciem bezpiecznego magazynu systemu, jeśli jest dostępny, a backend przechowuje jego hash.' },
  { keywords:['token'], answer:'Nie wysyłaj nikomu tokenów ani danych OAuth. Token aplikacji służy do uwierzytelnienia API i powinien pozostać prywatny.' },
  { keywords:['hasło'], answer:'ServiceOS nie potrzebuje hasła do konta Google. Hasło wpisujesz wyłącznie na stronie logowania Google.' },
  { keywords:['oauth'], answer:'Logowanie desktopowe używa Authorization Code z PKCE. To ogranicza ryzyko przechwycenia kodu autoryzacyjnego.' },
  { keywords:['email'], answer:'Adres e-mail z Google służy do identyfikacji konta i procesu przydzielenia dostępu.' },
  { keywords:['zdjęcie','profil'], answer:'Jeśli Google udostępni zdjęcie profilowe, ServiceOS może pokazać je przy koncie użytkownika.' },
  { keywords:['dane','google'], answer:'Do podstawowego logowania ServiceOS potrzebuje tylko zakresów openid, email i profile — nie treści Gmaila ani Dysku.' },
  { keywords:['gmail'], answer:'Podstawowe logowanie ServiceOS nie wymaga dostępu do treści Gmaila.' },
  { keywords:['dysk','drive'], answer:'Podstawowe logowanie ServiceOS nie wymaga dostępu do plików Google Drive.' },
  { keywords:['błąd','api'], answer:'Jeśli widzisz błąd API w development, upewnij się, że projekt jest uruchomiony pełnym poleceniem npm run dev.' },
  { keywords:['nie działa','logowanie'], answer:'Najpierw sprawdź internet i spróbuj ponownie. Jeśli Google pokaże konkretny kod błędu, skopiuj sam komunikat bez sekretów i tokenów.' },
  { keywords:['internet'], answer:'Logowanie Google, zewnętrzne strony i aktualizacje wymagają internetu. Część lokalnego interfejsu może działać bez sieci.' },
  { keywords:['offline'], answer:'Pełny tryb offline nie jest jeszcze docelową funkcją. Niektóre ekrany mogą się otworzyć, ale dane serwerowe wymagają API.' },
  { keywords:['pomoc'], answer:'Opisz problem jednym zdaniem. Najlepiej podaj ekran, czynność i komunikat błędu — bez haseł, tokenów i danych klientów.' },
  { keywords:['czat'], answer:'Obecny czat pomocy zapisuje rozmowę lokalnie na tym urządzeniu. Centralne zgłoszenia wsparcia dodamy razem z bazą danych.' },
  { keywords:['usuń','czat'], answer:'Historia pomocy jest obecnie lokalna. Przed wdrożeniem centralnej bazy dodamy kontrolowane czyszczenie i retencję rozmów.' },
  { keywords:['ciemny','motyw'], answer:'ServiceOS używa warstwowego ciemnego motywu: grafitowe tło, jaśniejsze panele i pomarańczowo-czerwone akcenty zamiast jednolitej czerni.' },
  { keywords:['jasny','motyw'], answer:'Priorytetem jest dopracowany ciemny motyw. Osobny jasny motyw możemy dodać później bez mieszania go z uprawnieniami i logiką danych.' },
  { keywords:['małe','okno'], answer:'Interfejs jest projektowany responsywnie. Gdy okno jest mniejsze, najważniejsze moduły mają zachować czytelność i przewijanie.' },
  { keywords:['github'], answer:'Kod, CI i wydania są spięte z GitHub. Build przechodzi typecheck, kompilację, audit zależności i test pakietowanego API.' },
  { keywords:['codeql'], answer:'CodeQL automatycznie analizuje kod JavaScript/TypeScript pod kątem klas podatności bezpieczeństwa.' },
  { keywords:['dependabot'], answer:'Dependabot pilnuje aktualizacji zależności npm i GitHub Actions, aby łatwiej reagować na poprawki bezpieczeństwa.' },
  { keywords:['backup','kopia'], answer:'Docelowe kopie zapasowe danych zaprojektujemy razem z centralną bazą. Nie warto udawać backupu przed ustaleniem modelu danych.' },
  { keywords:['baza'], answer:'Centralną bazę dodamy w następnym etapie. Wtedy dane punktów, napraw, klientów i wsparcia przestaną być lokalnym prototypem.' },
  { keywords:['klient','śled'], answer:'Portal klienta do śledzenia naprawy jest zaplanowany, ale pozostaje niedostępny do czasu wdrożenia bezpiecznej bazy i tokenów śledzenia.' },
  { keywords:['napraw'], answer:'Moduł właściwych napraw będzie rozwijany po podłączeniu centralnej bazy, żeby od początku nie budować go na tymczasowym magazynie.' },
  { keywords:['status','napraw'], answer:'Status naprawy będzie później pochodził z centralnej bazy. Publiczny podgląd klienta nie powinien ujawniać danych przez łatwy do odgadnięcia numer zlecenia.' },
  { keywords:['kod','klient'], answer:'Dla portalu klienta planujemy losowy, wygasający identyfikator śledzenia zamiast publicznego dostępu po samym numerze telefonu lub prostym ID.' },
  { keywords:['telefon','klient'], answer:'Nie należy używać samego numeru telefonu jako klucza do publicznego podglądu naprawy. To zbyt łatwe do odgadnięcia.' },
  { keywords:['prywat'], answer:'Dane klienta i napraw nie powinny trafiać do publicznego repozytorium ani GitHub Pages. Będą dostępne tylko przez uwierzytelnione API.' },
  { keywords:['sekret'], answer:'Sekretów, tokenów i haseł nie zapisujemy w repozytorium. Ujawniony sekret należy obrócić, a nie tylko usunąć z najnowszego commita.' },
  { keywords:['log','dziennik'], answer:'Dziennik audytu ma pokazywać istotne operacje administracyjne i logowania. Rozbudujemy go przy centralnej bazie.' },
  { keywords:['kto','zatwierdza'], answer:'Dostęp użytkownika zatwierdza Właściciel. Rozliczenia może zatwierdzać Szef lub Właściciel zgodnie z regułami modułu.' },
  { keywords:['co dalej'], answer:'Najbliższy etap to bezpieczeństwo i stabilność, potem centralna baza danych, a dopiero na niej właściwe zlecenia serwisowe i portal klienta.' }
];

const initialMessages: ChatMessage[] = [{
  id: 'welcome',
  author: 'assistant',
  name: 'LockOn Pomoc',
  text: 'Cześć. Jestem lokalnym asystentem ServiceOS. Znam najważniejsze funkcje, role, logowanie, bezpieczeństwo, aktualizacje i plan portalu klienta. Napisz pytanie własnymi słowami.',
  createdAt: new Date().toISOString()
}];

const loadMessages = (): ChatMessage[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialMessages;
    const parsed = JSON.parse(raw) as ChatMessage[];
    return Array.isArray(parsed) && parsed.length ? parsed.slice(-80) : initialMessages;
  } catch {
    return initialMessages;
  }
};

const normalize = (value: string) => value.toLocaleLowerCase('pl-PL');

const answerQuestion = (question: string) => {
  const q = normalize(question);
  let best: HelpAnswer | null = null;
  let bestScore = 0;
  for (const item of HELP_ANSWERS) {
    const score = item.keywords.reduce((sum, keyword) => sum + (q.includes(normalize(keyword)) ? 1 : 0), 0);
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  return bestScore > 0
    ? best!.answer
    : 'Nie mam jeszcze pewnej odpowiedzi na to pytanie. Opisz ekran i czynność dokładniej. Nie będę zgadywać — jeśli trzeba, przekażemy temat do wsparcia.';
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
    () => (simulatedSupportMode ? 'Pomoc · tryb wsparcia' : 'LockOn Pomoc'),
    [simulatedSupportMode]
  );

  if (!open) return null;

  const send = () => {
    const value = draft.trim().slice(0, 1500);
    if (!value) return;

    const asSupport = supportMode && simulatedSupportMode;
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      author: asSupport ? 'support' : 'user',
      name: asSupport ? 'Wsparcie LockOn' : (auth.user?.name ?? 'Użytkownik'),
      text: value,
      createdAt: new Date().toISOString()
    };

    if (asSupport) {
      setMessages((current) => [...current, userMessage].slice(-80));
    } else {
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        author: 'assistant',
        name: 'LockOn Pomoc',
        text: answerQuestion(value),
        createdAt: new Date().toISOString()
      };
      setMessages((current) => [...current, userMessage, assistantMessage].slice(-80));
    }
    setDraft('');
  };

  return (
    <>
      <button className="help-chat-backdrop" onClick={onClose} aria-label="Zamknij pomoc" />
      <aside className="help-chat-panel page-enter" aria-label="Pomoc LockOn">
        <header className="help-chat-header">
          <div className="help-chat-icon">{supportMode && simulatedSupportMode ? <Headphones size={18} /> : <Bot size={18} />}</div>
          <div>
            <strong>{title}</strong>
            <span>{supportMode && simulatedSupportMode ? 'Odpowiadasz jako wsparcie' : 'Lokalna pomoc · bez wysyłania pytań do chmury'}</span>
          </div>
          <button onClick={onClose} title="Zamknij"><X size={18} /></button>
        </header>

        {!simulatedSupportMode && (
          <div className="support-mode-note">
            <Sparkles size={15} />
            <div><strong>Asystent ServiceOS</strong><span>Baza pomocy zawiera ponad 50 tematów i nie wymyśla odpowiedzi, których nie zna.</span></div>
          </div>
        )}

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
              maxLength={1500}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
              placeholder={supportMode && simulatedSupportMode ? 'Napisz odpowiedź…' : 'Np. jak działa logowanie Google?'}
              rows={2}
            />
            <button className="help-send-button" onClick={send} disabled={!draft.trim()} title="Wyślij">
              <Send size={16} />
            </button>
          </div>
          <small>Enter wysyła · Shift + Enter dodaje nową linię · nie wpisuj haseł ani tokenów</small>
        </footer>
      </aside>
    </>
  );
}
