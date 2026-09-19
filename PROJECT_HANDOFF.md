# LockOn ServiceOS — handoff dla kolejnego chatu

> Ten plik jest źródłem ciągłości pracy nad projektem. Przed zmianami sprawdź aktualny `main`, latest release, workflows, repo strony oraz aktywną funkcję Neon. Nie zaczynaj projektu od zera.

## Repozytoria i środowisko

- Aplikacja: `LokosPL/LockOn-Hub`
- Strona / panel WWW: `LokosPL/lockon-serviceos-site`
- Produkcyjna domena: `https://app.serviceos.pl`
- Neon project: `LockOn ServiceOS`
- Neon project_id: `wandering-field-13057181`
- Neon branch_id: `br-steep-bonus-b1f1qh8u`
- Baza: `lockon`
- Neon Function slug: `lockonapi`
- API: `https://br-steep-bonus-b1f1qh8u-lockonapi.compute.c-5.eu-central-1.aws.neon.tech`

### Aktualny stan produkcyjny — 2026-09-19 / v0.17.0

- aplikacja `main`: `267196fcf77b41da085973c29345636d0b29c279`
- publiczny release Windows: `v0.17.0`
- instalator: `LockOn-ServiceOS-Setup.exe`, SHA-256 `bd04dbddbcddde1b431cb089cf9d8ad8b2ac4d6b27481842804427546882e204`
- strona / panel WWW `main`: `f9656b2c8f2bf5dbbe1c1b9c2f5a6c814270d512`
- GitHub Pages deploy po PR #9: sukces
- aktywny Neon `lockonapi`: deployment **v24**
- produkcyjny smoke v24: `/health` OK; chronione `/me`, zlecenia, finanse, factory-reset preview, factory reset i zmiana statusu zwracają 401 bez sesji
- PR aplikacji #30 i PR strony #9: scalone
- bez nowej migracji DB w v0.17.0

Najważniejsze invarianty po v0.17.0:
- status telefonu zmienia wyłącznie punkt, w którym urządzenie fizycznie się znajduje; OWNER/BOSS także muszą pracować w kontekście aktywnego właściwego punktu;
- podczas aktywnego transportu status naprawy jest zablokowany;
- zwykły USER nie może zmieniać statusów;
- `READY` wymaga `REPAIR_DONE` oraz fizycznego powrotu do punktu macierzystego;
- sesja WWW jest przechowywana w `localStorage`, 403 nie usuwa tokenu, a aktywne sesje WEB mają odnawiany 90-dniowy TTL;
- podgląd UI strony używa stałego `preview-stage` i nie stosuje `window.scrollBy`;
- factory reset ma preflight z licznikami i po transakcji weryfikuje wyzerowanie wszystkich tabel operacyjnych; **nie wykonywano resetu na produkcyjnych danych w ramach testu**;
- mail operacyjny zawsze wskazuje punkt, w którym znajduje się urządzenie / do którego jest przekazywane; własny footer nie usuwa tej informacji.

Stan produkcyjny po realizacji Priorytetu 1 (2026-09-18):
- release baseline `main`: `bbac27d7b588c650cc1b57f0cea8c528a07498d3` (commit handoffu jest późniejszy)
- publiczny release: `v0.12.0`
- PR aplikacji #22 i #23: scalone
- repo strony `main`: `5d4503d17958aa23a656dc3fe9b5b629b1e7398f`
- PR strony #3: scalony
- aktywny Neon deployment: v17
- migracja DB: `2026-09-18-central-v11` zastosowana na produkcyjnym `main`
- produkcyjny smoke v16: `/health` OK, `/me` bez sesji = 401
- GitHub Pages / `app.serviceos.pl`: deploy po PR #3 zakończony sukcesem
- Gmail test i wiadomości logistyczne działają produkcyjnie

## Zasady współpracy

- Odpowiadaj po polsku.
- Jeśli można coś wykonać przez GitHub / Neon / narzędzia, wykonaj to sam.
- Jeśli konieczna jest ręczna czynność użytkownika w UI, podawaj jedną rzecz na raz.
- Nie proś o sekrety, hasła ani tokeny w czacie.
- Przed większymi zmianami sprawdź aktualny stan repozytoriów i Neon.
- Nie cofaj istniejących zabezpieczeń.
- Nie pokazuj pełnego katalogu ról użytkownikom innym niż OWNER.

## Role

- OWNER — globalnie wszystko
- BOSS — globalne punkty, naprawy, przychody, rozliczenia
- COORDINATOR — wybrane punkty
- SUPPORT — wybrane punkty + support
- TECHNICIAN — wybrane punkty + naprawy + własne przychody
- USER — podstawowy dostęp punktowy
- PENDING jest statusem, nie rolą

Koszty zleceń widzą i edytują OWNER / BOSS / COORDINATOR oraz TECHNICIAN w zakresie zleceń, do których ma dostęp. USER nie widzi ani nie edytuje kosztów.

## Najważniejsze istniejące funkcje

### Serwis
- klient + karta klienta
- urządzenia, IMEI, serial
- opis usterki
- REPAIR / COMPLAINT
- statusy naprawy, w tym `REPAIR_DONE` = naprawa zakończona, ale urządzenie nie musi być jeszcze gotowe do odbioru
- technik
- przewidywany termin
- koszt szacowany / końcowy
- notatki wewnętrzne
- historia statusów
- deduplikacja klienta
- unikalny niepusty IMEI

### Przekazania
Tabela: `service_order_transfers`

Aktualne statusy:
- REQUESTED
- IN_TRANSIT
- DELIVERED
- ACCEPTED
- REJECTED
- CANCELLED

Kierunek logistyczny jest osobnym polem `kind`:
- `OUTBOUND_SERVICE` — wysyłka z bieżącego punktu do zewnętrznego serwisu
- `RETURN_HOME` — obowiązkowy powrót do punktu macierzystego

Zlecenie ma rozdzieloną semantykę lokalizacji:
- `point_id` — historyczne pole kompatybilności / pierwotny punkt
- `home_point_id` — trwały punkt macierzysty
- `current_point_id` — aktualna fizyczna lokalizacja; `NULL` podczas transportu jest prawidłowe
- backend używa `point_id` jako bezpiecznego fallbacku home podczas zgodności wstecznej
- produkcyjny `home_point_id` pozostaje celowo nullable dla rolling-deploy compatibility; wszystkie istniejące rekordy są zbackfillowane, a v16 zapisuje go jawnie
- świeży schema w `database/schema.sql` wymaga `home_point_id` przy nowych instalacjach
- `READY` i `COMPLETED` są blokowane, dopóki urządzenie nie wróci i nie zostanie przyjęte w punkcie macierzystym
- `COMPLETED` wymaga wcześniejszego `READY`

Punkty mają:
- `service_enabled`
- `accepts_external_repairs`
- `service_note`

### Powiadomienia
- Gmail `gmail.send`
- HTML + text
- kolejka i retry
- worker Neon co 5 minut
- test Gmail działa
- osobne maile logistyczne rozróżniają wysyłkę do serwisu i `RETURN_HOME`
- klient dostaje informację o powrocie urządzenia do punktu macierzystego
- e-mail `READY` mówi o odbiorze w punkcie macierzystym i jest możliwy dopiero po zakończeniu logistyki zwrotnej

### WWW / PWA
- landing page na `app.serviceos.pl`
- logowanie kodem z aplikacji w prawym górnym rogu
- `panel.html` jako mobilny panel
- PWA + service worker
- mobilne: nowe zlecenie, zlecenia, status, notatki, transfery, administracja OWNER
- desktop i mobile pokazują punkt macierzysty oraz aktualną fizyczną lokalizację
- desktop i mobile mają osobną akcję „Odeślij do punktu macierzystego” po `REPAIR_DONE`

### OWNER
- blokada / odblokowanie kont
- blokada od razu unieważnia sesje
- wylogowanie wszystkich sesji użytkownika
- wylogowanie wszystkich poza bieżącym OWNER
- sesje WWW / desktop
- audyt
- konfiguracja punktów / serwisów

## Google / Gmail

Desktop Client ID:
`996585439932-e10mu53j95s6u13vrua841tm4oco38so.apps.googleusercontent.com`

Web Client ID:
`996585439932-uaoifil2rud5q6h0ibp1coqn8vi0p3u3.apps.googleusercontent.com`

Gmail scope:
`https://www.googleapis.com/auth/gmail.send`

Nie rozszerzaj zakresu bez potrzeby. ServiceOS nie czyta skrzynki Gmail.

Backend ma przygotowane server-side Authorization Code + PKCE:
- `/auth/google-code`
- `/integrations/gmail/connect-code`

Historycznie istnieje bezpieczny fallback desktopowy, jeśli sekret server-side nie jest jeszcze skonfigurowany.

## Bezpieczeństwo

Istnieją:
- Electron sandbox
- contextIsolation
- nodeIntegration=false
- IPC validation
- CSP
- OAuth PKCE + state
- backend ID token verification
- safeStorage
- hashowane tokeny
- CodeQL
- Dependabot
- npm audit
- SHA-256
- Artifact Attestations
- ścisły CORS dla `app.serviceos.pl`, starego GitHub Pages i localhost dev

---

# PRIORYTETY HISTORYCZNE — 1–5 WYKONANE PRODUKCYJNIE

## 1. [WYKONANE] Punkt macierzysty telefonu i obowiązkowy powrót z serwisu

Zrealizowane i wdrożone produkcyjnie w v0.11.0 / Neon v16.

Wdrożono:
- trwałe `home_point_id` i fizyczne `current_point_id`;
- migrację `2026-09-18-central-v11` z backfillem istniejących danych;
- `OUTBOUND_SERVICE` i `RETURN_HOME` jako rozłączne kierunki logistyczne;
- status `REPAIR_DONE`, oddzielający zakończenie naprawy od gotowości klienta;
- obowiązkową akcję „Odeślij do punktu macierzystego” po naprawie w obcym serwisie;
- blokadę backendową `READY` / `COMPLETED` przed fizycznym powrotem;
- wymóg `READY` przed `COMPLETED`;
- czytelny punkt macierzysty i aktualną lokalizację w desktop oraz mobile/PWA;
- osobne teksty e-mail dla outbound i return-home;
- produkcyjny smoke `/health` + kontrolę, że `/me` bez sesji nadal zwraca 401;
- release desktop `v0.11.0`.

Historyczny przypadek `Nowogard → serwis → Nowogard` został poprawnie rozpoznany przez backfill jako `OUTBOUND_SERVICE` + `RETURN_HOME`.

Nie implementuj tego od nowa. Przy kolejnych zmianach pilnuj regresji tych invariantów.

## 2. [WYKONANE] Gmail automatyczny i niewidoczny, jeśli już działa

Zrealizowane i wdrożone produkcyjnie w v0.12.0 / Neon v17.

Wdrożono:
- lekki automatyczny check połączenia Gmail po wejściu do Serwisu i zmianie punktu;
- działający, kompletny nadawca nie pokazuje już globalnego bannera ani przycisku „Połącz Gmail”;
- historia i pełne ustawienia powiadomień są pobierane dopiero po wejściu do zakładki „Powiadomienia”;
- pierwsze połączenie pokazuje jedno czytelne CTA;
- ponowne OAuth pojawia się wyłącznie przy rzeczywistym `REAUTH_REQUIRED`;
- backend odświeża token przy sprawdzaniu statusu i rozpoznaje Google `invalid_grant` jako wygasłą/cofniętą zgodę;
- taki przypadek zapisuje nadawcę jako `REVOKED`;
- chwilowe problemy Google są raportowane jako `TEMPORARY_ERROR` i nie wymuszają fałszywej ponownej zgody;
- test/odłączenie Gmail są dostępne w zakładce „Powiadomienia”, a nie jako stały element głównego widoku;
- błędy testu/wysyłki wymagające nowej zgody również ustawiają `REVOKED`;
- scope pozostaje ograniczony do `gmail.send`;
- produkcyjny smoke v17 potwierdził `/health` oraz ochronę `/me` i `/integrations/gmail` bez sesji;
- release desktop `v0.12.0` przeszedł release workflow, CodeQL i pełny Windows package smoke.

Brak migracji DB dla tego priorytetu. Produkcyjny rekord nadawcy pozostawał `ACTIVE` bez błędu po wdrożeniu v17.

Nie przywracaj stałego bannera Gmail przy poprawnym połączeniu. Ponowne OAuth ma być reakcją na trwałą utratę zgody, nie na chwilowy błąd sieci/provider.

## 3. [WYKONANE] Porządek i stopniowanie zleceń — „co robimy dalej”

Obecna lista zleceń ma zostać przekształcona w czytelny workflow pracy.

Potrzebny widok pokazujący użytkownikowi:
- numer etapu / kolejność procesu;
- aktualny etap;
- **następną wymaganą akcję**;
- termin / ETA;
- pilność.

Przykładowy logiczny przebieg:
1. Przyjęte
2. Do diagnozy
3. Diagnoza
4. Oczekiwanie na decyzję / części (jeśli dotyczy)
5. W naprawie
6. Naprawa zakończona
7. Zwrot z serwisu do punktu macierzystego (jeśli zewnętrzny serwis)
8. Dostarczone do punktu macierzystego
9. Gotowe do odbioru
10. Zakończone

Dodaj sekcje / filtry typu:
- Wymaga działania teraz
- Kończy się termin
- Po terminie
- W drodze
- Czeka na serwis
- Czeka na części
- Gotowe do odbioru

Zlecenia z bliskim ETA powinny być wyżej i mieć czytelny alert. Nie rób tylko kosmetycznego sortowania; backend i UI powinny mieć jednoznaczną logikę „next action”.

## 4. [WYKONANE] TECHNICIAN przypisany do punktu automatycznie czyni punkt celem przekazania

Jeżeli OWNER nada komuś rolę TECHNICIAN dla danego punktu:
- ten punkt ma automatycznie pojawić się użytkownikom jako możliwy punkt docelowy przekazania urządzenia;
- użytkownik z uprawnieniami do tworzenia zleceń może wysłać telefon do takiego punktu;
- nie powinno być konieczne ręczne włączanie drugiego ukrytego przełącznika, żeby zwykły użytkownik zobaczył punkt w selektorze.

Preferowana reguła:
- punkt z co najmniej jednym ACTIVE TECHNICIAN przypisanym do niego jest serwisem dostępnym do przekazania;
- konfiguracja OWNER może dodatkowo pozwalać czasowo wyłączyć przyjmowanie zewnętrznych napraw;
- po usunięciu ostatniego technika punkt nie powinien automatycznie przyjmować nowych transferów, chyba że istnieje jawna konfiguracja biznesowa uzasadniająca wyjątek.

Sprawdź i ujednolić:
- admin role assignment
- `service_enabled`
- `accepts_external_repairs`
- `GET /service/service-points`
- desktop selector
- mobile selector

## 5. [WYKONANE] OWNER: „Wymaż całą bazę danych”

OWNER ma dostać bardzo silną funkcję resetu danych.

Nie rób prostego `DROP DATABASE`, bo aplikacja przestanie działać.

Zaimplementuj bezpieczny „Factory reset danych ServiceOS”:
- tylko OWNER;
- najlepiej wymaga świeżego potwierdzenia tożsamości / re-auth, jeśli architektura pozwala;
- wymagane wpisanie dokładnej frazy, np. `USUŃ WSZYSTKIE DANE`;
- drugi modal potwierdzający;
- endpoint backendowy tylko dla OWNER;
- transakcja;
- usuwa dane biznesowe i użytkowników/sesje zgodnie z dobrze zdefiniowaną kolejnością FK;
- zachowuje schemat, migracje i niezbędną konfigurację systemową;
- po resecie OWNER musi mieć możliwość ponownego wejścia / bootstrapu;
- dobrze byłoby przed resetem umożliwić eksport / backup, ale reset nie może zależeć od klienta;
- każda próba resetu powinna być audytowana przed właściwym czyszczeniem w sposób, który nie znika bez śladu, jeśli da się to zrobić bezpiecznie.

Przed implementacją przeanalizuj FK i wszystkie tabele w Neon. Nie kasuj projektu Neon ani schematu SQL.

---

# AKTUALNY BACKLOG — PRIORYTETY 1–10

> To jest aktualna kolejka pracy po v0.17.0. Historyczne priorytety 1–5 powyżej są już wdrożone. Nowy chat ma realizować poniższe punkty kolejno i samodzielnie, bez ponownego pytania użytkownika o informacje możliwe do sprawdzenia w GitHub/Neon. Każdy priorytet obejmuje backend, desktop i panel WWW/PWA wszędzie tam, gdzie dana funkcja występuje.

## 1. USER — pełny, ale ograniczony workflow przyjęcia zlecenia

Rola `USER` ma:
- móc normalnie utworzyć nowe zlecenie serwisowe;
- edytować dane klienta i podstawowe dane przyjęcia;
- móc anulować zlecenie, gdy klient rezygnuje;
- móc przekazać urządzenie dalej do serwisu / właściwego punktu;
- **nie** móc zmieniać zwykłych statusów naprawy (diagnoza, naprawa, gotowe itd.);
- nie widzieć kosztów serwisowych, rozliczeń ani danych zarządczych.

Dashboard USER ma nie pokazywać:
- „Punkty w zasięgu”;
- „Aktywne konta”;
- „Zatwierdzony przychód”.

Panel WWW/PWA ma ukrywać moduły i przyciski bez uprawnień, w szczególności Administrację. To samo musi być egzekwowane backendowo — ukrycie UI nie może być jedynym zabezpieczeniem.

Kryterium zakończenia: test ról dla desktop + mobile + API, w tym próba niedozwolonej zmiany statusu przez USER = 403, ale create/cancel/customer edit/transfer działają.

## 2. Serwis — czytelne karty zleceń + niezawodny e-mail po przyjęciu

Przebudować kartę zlecenia `#1`, `#2` itd. tak, aby najważniejsze dane były czytelne bez rozwijania:
- duży numer zlecenia;
- data i godzina przyjęcia;
- klient + urządzenie;
- punkt macierzysty;
- aktualna lokalizacja;
- przypisany serwisant;
- aktualny etap;
- termin;
- cena orientacyjna / końcowa dla uprawnionych;
- czytelne kolory statusu, terminu i lokalizacji.

Naprawić wysyłkę e-mail po przyjęciu telefonu. Potwierdzenie przyjęcia ma być wysyłane deterministycznie, z istniejącym firmowym fallbackiem Gmail i kolejką/retry. Nie wolno uznawać utworzenia zlecenia za „mail wysłany”, jeśli provider go nie przyjął.

Kryterium zakończenia: produkcyjnie sprawdzony flow utworzenia zlecenia z adresem klienta + rekord SENT/provider id albo czytelny stan kolejki/retry; brak cichej porażki.

## 3. E-maile klienta i publiczna karta serwisowa

Przebudować HTML wszystkich wiadomości tak, aby były responsywne na telefonie:
- pojedyncza kolumna;
- bez rozjeżdżania szerokości;
- duże CTA i typografia;
- poprawne zawijanie długich danych;
- wersja text jako fallback.

Link „Sprawdź szczegóły” ma prowadzić do jednej spójnej karty serwisowej klienta. Usunąć obecny efekt „ładowanie → błąd plików → niżej urządzenie”.

Karta publiczna ma pokazywać tylko potrzebne informacje:
- numer zlecenia;
- dane urządzenia podane przy przyjęciu;
- dane klienta w bezpiecznym zakresie;
- aktualny status;
- aktualną fizyczną lokalizację / punkt;
- punkt macierzysty, jeśli potrzebny do zrozumienia procesu;
- przewidywany termin, jeśli istnieje;
- prostą historię najważniejszych etapów, jeśli poprawia czytelność.

Nie dodawać wymyślonych danych ani modułów niezwiązanych z konkretnym zleceniem. Token śledzenia ma pozostać bezpieczny i nie może ujawniać innych zleceń.

## 4. Wsparcie / konsultant — realny workflow i zakres punktów

Obecna funkcja SUPPORT ma zacząć realnie działać.

Użytkownik w Pomocy ma mieć prostą akcję:
- „Poproś konsultanta o pomoc” / „Poproś o pomoc osobę”.

Zgłoszenie powinno tworzyć rozmowę/ticket widoczny właściwym konsultantom. SUPPORT ma być rolą punktową:
- przypisywaną do konkretnych punktów;
- konsultant widzi zgłoszenia tylko ze swoich punktów, chyba że ma rolę globalną;
- odpowiedzi konsultanta pojawiają się użytkownikowi w Pomocy;
- audyt zapisuje utworzenie, przejęcie, odpowiedź i zamknięcie zgłoszenia.

Nie twórz „martwego” przycisku; cały flow musi działać end-to-end desktop/API.

## 5. Administracja — przebudowa „Konta i uprawnienia”

Przebudować panel OWNER, bo obecny układ jest zbyt techniczny i mało czytelny.

Wymagania:
- czytelna karta użytkownika: imię, e-mail, rola, przypisany punkt/punkty, status, ostatnie logowanie;
- po akceptacji konto ma mieć przypisanie punktu i nie powinno pokazywać zbędnego wyboru „nazwy sklepu” przy każdej operacji;
- dodać jednoznaczną akcję **Edytuj konto**;
- w edycji OWNER może zmienić rolę, punkty, blokadę i właściwe parametry serwisanta;
- onboarding pending może nadal wykorzystać punkt zgłoszony przez pracownika, ale decyzja OWNER ma być jasna i pojedyncza;
- polskie nazwy i opis biznesowy zamiast technicznych kodów ról tam, gdzie widzi je zwykły użytkownik.

Nie osłabiaj zabezpieczeń OWNER ani unieważniania sesji przy blokadzie.

## 6. Audyt — szczegółowy i użyteczny operacyjnie

Rozbudować audyt tak, aby OWNER mógł ustalić kto/co/kiedy/gdzie zmienił.

Dla istotnych zdarzeń zapisywać i prezentować:
- aktora;
- rolę;
- punkt;
- typ obiektu i jego identyfikator;
- stary stan → nowy stan dla zmian;
- numer zlecenia, jeśli dotyczy;
- klient/urządzenie w bezpiecznym skrócie, jeśli potrzebne;
- status wysyłki e-mail / transferu / rozliczenia;
- czas;
- typ klienta (desktop/web) jeśli dostępny.

UI audytu: filtry po użytkowniku, punkcie, typie zdarzenia, zleceniu i zakresie dat; rozwijane szczegóły JSON tylko jako opcja techniczna, nie główny widok.

## 7. Rozliczenia BOSS — punkty + całość firmy

BOSS ma widzieć:
- łączny przychód serwisowy firmy;
- łączny udział serwisantów;
- udział firmy/Szefa;
- podział per punkt;
- możliwość rozwinięcia punktu i zobaczenia jego zleceń/przychodów;
- serwisanta, kwotę, procent zapisany dla danego rozliczenia i datę.

Nie wracaj do stałego 50/50. Obowiązuje model z v0.15+: każdy TECHNICIAN ma własny procent, a `revenue_entries` przechowuje snapshot procentu dla historycznego wpisu.

Dane muszą liczyć się poprawnie zarówno dla automatycznych rozliczeń ze zleceń, jak i dopuszczonych ręcznych wpisów.

## 8. Publiczna strona — prostszy język i krótszy onboarding

Przejrzeć całą `app.serviceos.pl` z perspektywy osoby, która pierwszy raz widzi system.

Wymagania:
- mniej tekstu;
- krótkie, konkretne sekcje;
- proste polskie nazwy zamiast `OWNER`, `TECHNICIAN`, itp. w treści dla pracownika;
- zamiast wyjaśniania technicznych uprawnień pisać np. „Twoje konto musi zostać zaakceptowane przez osobę uprawnioną”;
- nie opisywać użytkownikowi wewnętrznych mechanizmów, których nie potrzebuje do rozpoczęcia pracy;
- zachować działający podgląd UI, ale bez skakania strony;
- regulamin/akceptacja pozostają na dole procesu;
- dopiero po akceptacji: pobranie aplikacji i łączenie telefonu;
- zachować mobile-first, czytelną typografię i istniejące zabezpieczenia CSP/PWA.

## 9. Pełny przegląd techniczny i sprzątanie projektu

Po funkcjonalnych poprawkach zrobić analizę obu repozytoriów:
- martwy kod;
- nieużywane komponenty;
- stare workflow jednorazowe;
- stare deploy/export/smoke pliki operacyjne;
- duplikaty API/fallbacków;
- nieużywane assety;
- stare cache i wersje;
- nieaktualne komentarze / dokumentację;
- zależności npm, które nie są używane;
- ostrzeżenia build/lint/CodeQL.

Usuwać tylko po potwierdzeniu przez kod/search/workflows, że element nie jest używany. Nie kasować migracji historycznych ani elementów potrzebnych do odtworzenia produkcji.

Na końcu zaktualizować `PROJECT_HANDOFF.md` i opisać, co faktycznie usunięto.

## 10. Google login callback — po polsku, auto-close i powrót do aplikacji

Po logowaniu Google obecna strona callbacku ma być poprawiona:
- w 100% po polsku;
- bez technicznych tekstów typu „ACTIVE/OWNER” dla zwykłego pracownika;
- jasne „Logowanie zakończone. Wracamy do ServiceOS.”;
- automatyczne zamknięcie karty po ok. 5 sekundach;
- jeśli bezpiecznie możliwe w Electron: zarejestrować i wykorzystać deep link / custom protocol, aby po sukcesie natychmiast aktywować okno aplikacji;
- jeśli przeglądarka nie pozwala automatycznie zamknąć karty, pokazać prosty przycisk „Wróć do aplikacji” i nadal wykonać próbę auto-close;
- analogicznie uprościć stronę błędu logowania.

Sprawdzić desktop OAuth PKCE/state oraz nie osłabić obecnej ochrony callbacku.

## Wspólna definicja ukończenia dla aktualnego backlogu

Dla każdego priorytetu:
1. Najpierw sprawdź aktualny `main`, kod i produkcyjne dane — nie zakładaj, że opis jest w 100% aktualny.
2. Zmiany schematu testuj najpierw na tymczasowej gałęzi Neon.
3. Backend ma egzekwować uprawnienia niezależnie od UI.
4. Ujednolić desktop i WWW/PWA.
5. Uruchomić istniejące Verify/CI/CodeQL i nie scalać czerwonych zmian.
6. Po backendzie zrobić smoke produkcji z kontrolą endpointów chronionych.
7. Nie wykonywać factory reset ani innych destrukcyjnych testów na danych produkcyjnych.
8. Po wdrożeniu aktualizować ten plik i przechodzić od razu do kolejnego priorytetu, bez pytania użytkownika o zgodę na zwykłe prace developerskie.
9. Jawne potwierdzenie użytkownika jest nadal wymagane, jeśli narzędzie wymaga go dla destrukcyjnej/produkcyjnej migracji lub innej nieodwracalnej operacji.

## Stan realizacji aktualnego backlogu 1–5 — 2026-09-19

- Priorytet 1: kod desktop/API i PWA scalony; regresje USER poprawione. Produkcja nie ma konta USER, więc nie tworzono sztucznego konta/danych tylko do testu roli.
- Priorytet 2: scalone czytelne karty zleceń desktop/PWA oraz deterministyczne kolejkowanie e-mail po przyjęciu; wysyłka jest uznawana za SENT dopiero po provider message id, a błędy pozostają retryable w outbox.
- Priorytet 3: scalone responsywne wiadomości klienta i spójna, privacy-safe publiczna karta śledzenia.
- Priorytet 4: scalony punktowy workflow konsultanta; produkcyjny schemat ma point_id, assigned_support_user_id, taken_at i closed_at w support_conversations.
- Priorytet 5: scalone PR Hub #37 i PWA #14; czytelne karty kont, jawne „Edytuj konto”, role/punkty/blokada/parametr rozliczenia technika; blokada nadal unieważnia sesje, OWNER chroniony.
- P5 checks: Verify Neon API bundle #5 SUCCESS, Verify ServiceOS #444 SUCCESS, CodeQL #228 SUCCESS; PWA Verify #109 SUCCESS.
- Zweryfikowany bundle API dla P1–P5: artifact lockon-central-api z run 35447335266, SHA-256 artifact digest 1f5f35c76a20e4039c9adec14b77393e08a0e72dcd89826457c8dc05b3101c91.
- UWAGA wdrożeniowa: aktywny Neon lockonapi pozostaje v24 do czasu przesłania zweryfikowanego ZIP-a do deploy_function. Nie oznaczać backendowej części P1–P5 jako produkcyjnie zamkniętej przed nowym deploymentem i smoke.

## Priorytet 6 — ZROBIONE produkcyjnie (2026-09-19)

- Hub PR #38 i PWA PR #15 scalone.
- OWNER ma filterowalny audyt po użytkowniku, punkcie, typie zdarzenia, numerze zlecenia i zakresie dat.
- Widok pokazuje aktora, rolę, punkt, obiekt/id, stary→nowy stan, numer zlecenia, bezpieczny skrót klienta/urządzenia, status e-mail/transfer/rozliczenie, czas i typ klienta WEB/Desktop, gdy jest dostępny.
- JSON pozostaje opcjonalnym rozwijanym widokiem technicznym.
- Verify ServiceOS #453 SUCCESS, Verify Neon API bundle #7 SUCCESS, CodeQL #232 SUCCESS, PWA Verify #115 SUCCESS.
- Neon lockonapi wdrożony jako v26 z artifact digest SHA-256 b4e896d7dd489b9434255d46cce23924dd5707cfd5345e4ed185bad155b45fb9.
- Bez zmian schematu DB; produkcja ma istniejące zdarzenia audytu, a nowy endpoint czyta je bez destrukcyjnych testów.

## Priorytet 7 — ZROBIONE produkcyjnie (2026-09-19)

- Hub PR #39 i PWA PR #16 scalone.
- BOSS/OWNER widzi łączny przychód firmy, łączny udział serwisantów, udział firmy/Szefa oraz rozbicie per punkt.
- Punkt można rozwinąć do wpisów/zleceń z serwisantem, kwotą, snapshotem procentu i datą; wpisy ręczne i automatyczne są rozróżnione.
- Model nie wraca do stałego 50/50: każdy wpis używa zapisanego `technician_percent`; historia zachowuje snapshot.
- Verify ServiceOS #460 SUCCESS, Verify Neon API bundle #8 SUCCESS, CodeQL #235 SUCCESS, PWA Verify #120 SUCCESS.
- Neon lockonapi wdrożony jako v27 z artifact digest SHA-256 5d60feed08bb57ec39385f31bda7a37d5e9a4f0e3f8d9cbf77cead99e69af11d.
- Produkcyjny odczyt kontrolny: Sklep LockOn 1800 PLN przychodu / 900 PLN serwisant / 900 PLN firma.
- Bez zmian schematu DB i bez destrukcyjnych testów.

## Jak zacząć w nowym czacie

1. Otwórz i przeczytaj **cały** `PROJECT_HANDOFF.md`.
2. Sprawdź aktualny `main`, latest release, otwarte PR-y i wszystkie aktywne workflow w obu repozytoriach.
3. Sprawdź Neon: projekt `wandering-field-13057181`, produkcyjną gałąź `br-steep-bonus-b1f1qh8u`, bazę `lockon`, aktywny deployment `lockonapi` oraz schemat.
4. Historyczne priorytety 1–5 są wdrożone. **Aktualna praca zaczyna się od nowego Priorytetu 1 z sekcji „AKTUALNY BACKLOG — PRIORYTETY 1–10”.**
5. Realizuj kolejno 1 → 10. Po zakończeniu jednego przechodź do następnego bez pytania użytkownika, chyba że konieczna operacja wymaga jawnego potwierdzenia.
6. Pracuj samodzielnie przez GitHub i Neon; nie proś użytkownika o informacje, które można sprawdzić narzędziami.
