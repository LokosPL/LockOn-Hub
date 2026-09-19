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

Koszty zleceń są przeznaczone tylko dla OWNER / BOSS / COORDINATOR.

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

# STAN PRIORYTETÓW — 1–5 WYKONANE PRODUKCYJNIE

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

## Jak zacząć w nowym czacie

1. Otwórz ten plik z GitHub.
2. Sprawdź aktualny `main`, latest release i workflows.
3. Sprawdź aktywny deployment `lockonapi` w Neon i aktualny schemat.
4. Priorytety 1–5 są wdrożone. Nie implementuj ich od nowa; zacznij od aktualnych zgłoszeń/regresji użytkownika i sprawdź invarianty opisane w sekcji v0.17.0.
5. Wykonuj zmiany samodzielnie przez GitHub/Neon i dopiero przy koniecznej ręcznej czynności poproś użytkownika o jeden krok.
