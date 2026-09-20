# LockOn ServiceOS — pakiet START dla kolejnego chatu

> Ten plik jest instrukcją operacyjną dla kolejnego chatu. Pełna historia projektu i invarianty są w `PROJECT_HANDOFF.md`. Nie zaczynaj projektu od zera.

## Jak reagować na komendy użytkownika

### Gdy użytkownik napisze: `GitHub Neon`

1. Połącz się z GitHub i Neon dostępnymi narzędziami.
2. Przeczytaj **cały** `PROJECT_HANDOFF.md` oraz ten plik.
3. Sprawdź aktualnie, nie z pamięci:
   - `LokosPL/LockOn-Hub` → `main`, latest release, otwarte PR-y, ostatnie workflow;
   - `LokosPL/lockon-serviceos-site` → `main`, otwarte PR-y, deploy Pages i verify;
   - Neon project `wandering-field-13057181`, produkcyjną branch `br-steep-bonus-b1f1qh8u`, bazę `lockon`, funkcję `lockonapi`, aktywny deployment i schemat.
4. Nie pytaj użytkownika o informacje, które da się sprawdzić w GitHub/Neon.
5. Odpowiedz krótko, że stan został odczytany i czekasz na `START`.

### Gdy użytkownik napisze: `START`

Zacznij wykonywać backlog od **pierwszego niezamkniętego priorytetu**, samodzielnie. Priorytet **0A jest zakończony**; obecnie następnym niezamkniętym jest **0B**. Nie opisuj tylko planu. Twórz gałęzie, zmiany, testy, PR-y, temp Neon, smoke i wdrożenie produkcyjne, jeśli wszystko jest zielone.

Komunikacja:
- po polsku;
- mało tekstu, dużo wykonywania;
- informuj tylko o ważnych checkpointach, błędach i wyniku;
- nie pytaj o zgodę na zwykłe zmiany kodu, PR, testy i bezpieczny temp deploy;
- pytaj tylko, jeśli potrzebna jest ręczna czynność właściciela, sekret albo operacja destrukcyjna;
- nie proś o hasła, tokeny ani sekrety w czacie.

## Stan produkcyjny przy tworzeniu tego pakietu — 2026-09-20

- Hub `main`: `dae6c15d80551e1c89c952fbc5a4d24276c076b5`
- Windows release: **v0.20.5**
- instalator SHA-256: `f4f776475e3ad3f51e4314bbabd9ec8c34076ee89bb988738bb99299226d51cf`
- release workflow #45 SUCCESS; Verify #620 SUCCESS; CodeQL #331 SUCCESS
- Site nadal po **Site PR #35 / Pages #102**; przed nową pracą sprawdź aktualny `main` i Pages ponownie
- Neon production `lockonapi`: **deployment v38**, completed
- produkcyjna branch Neon: `br-steep-bonus-b1f1qh8u`
- baza: `lockon`
- portal pracownika WWW pozostaje **code-only**
- portal klienta: kod = podgląd, Google = pełne konto
- Priorytet **0A zakończony**; następny niezamknięty: **0B**
- temp smoke v0.20.5 wykorzystał zachowaną branch `verify-hotfix-v0204` / `br-spring-pond-b1hqe48m`; projekt Neon ma obecnie limit branchy, więc nie usuwaj żadnej gałęzi bez potwierdzenia właściciela

Zawsze sprawdź ten stan ponownie przed pracą, bo może się zmienić.

---

# NOWY BACKLOG — wykonywać w tej kolejności

## PRIORYTET 0A — ZAKOŃCZONY — Pomoc: bot działa także podczas rozmowy z konsultantem

### Status

Zakończony w PR #61 i utrzymany w v0.20.5. Nie implementuj ponownie bez nowej regresji. BOT i CONSULTANT działają równolegle, self-support jest blokowany backendowo, a prywatne wiadomości BOT nie trafiają do SupportDesk.

### Historyczny problem produkcyjny

Na koncie OWNER można doprowadzić do stanu, w którym właściciel jest przypisany jako konsultant do własnej rozmowy. UI pokazuje np. „Lokos jest w rozmowie”, a bot przestaje odpowiadać. To samo jest logicznie złe dla innych użytkowników: dołączenie konsultanta nie powinno odbierać dostępu do bota.

Aktualna przyczyna w backendzie:
- `functions/lockon-api.mjs`, endpoint `POST /assistant/chat`;
- gdy `support_conversations.assigned_support_user_id` jest ustawione, backend zapisuje wiadomość użytkownika i zwraca `assistantMessage:null`, `consultantState:'JOINED'`;
- `src/components/HelpChat.tsx` dodatkowo komunikuje „Bot nie odpowiada automatycznie”.

### Docelowa logika

- Bot **zawsze** pozostaje dostępny dla użytkownika.
- Konsultant jest dodatkowym kanałem pomocy, nie zamiennikiem bota.
- Po dołączeniu konsultanta UI ma jasno rozróżniać:
  - „Zapytaj bota”;
  - „Napisz do konsultanta”.
- Najlepiej jedna rozmowa, ale z jawnym targetem wiadomości `BOT | CONSULTANT` w metadanych; nie mieszaj odpowiedzi przypadkowo.
- Gdy użytkownik wybiera BOT, `/assistant/chat` zawsze generuje odpowiedź bota niezależnie od przypisanego konsultanta.
- Gdy wybiera konsultanta, wiadomość trafia do kolejki/ticketu wsparcia i nie musi generować odpowiedzi bota.
- Stan `WAITING/JOINED` dotyczy tylko kanału ludzkiego; nie wyłącza funkcji bota ani narzędzi diagnostycznych.
- Dodaj akcję „Zakończ rozmowę z konsultantem / wróć tylko do bota”, która zwalnia human assignment bez kasowania prywatnej historii bota.

### Self-support / OWNER

- Nie pozwalaj, aby użytkownik przejął jako konsultant **własny** ticket; backend powinien to odrzucić lub SupportDesk powinien wykluczać własny ticket i backend też ma to egzekwować.
- Jeżeli w produkcji istnieje już self-assignment, migracja/naprawa ma bezpiecznie go zwolnić, nie usuwać historii.
- OWNER nadal ma pełne uprawnienie Wsparcie LockOn dla **innych** użytkowników.
- Dodaj test regresyjny: OWNER otwiera Pomoc → bot odpowiada; konsultant dołącza do innego usera → user nadal może wybrać bota; self-take = 409/403.

### Pliki startowe

- `src/components/HelpChat.tsx`
- `src/pages/SupportDesk.tsx`
- `functions/lockon-api.mjs`
- `electron/main.ts`, `electron/preload.ts`, `src/types/electron.d.ts` jeśli dochodzi nowy endpoint/target

---

## PRIORYTET 0B — WWW na telefonie: poprawić ekran wpisywania kodu pracownika

### Problem widoczny na zrzucie

Na wąskim ekranie karta „Połącz telefon z ServiceOS” jest przycięta poziomo: lewa część nagłówka, instrukcji i pól wychodzi poza viewport. Użytkownik ma widzieć całość bez poziomego przesuwania.

### Wymagania

- `portal-login-dialog` i `portal-login-card` zawsze mieszczą się w viewport 320/360/390 px.
- Brak ujemnych przesunięć, overflow-x i obciętego tekstu.
- Kroki 1–2–3 na telefonie przechodzą w jedną kolumnę albo bezpieczny układ pionowy.
- Pole kodu i CTA na telefonie są pionowo: input 100%, button 100%, bez wymuszania minimalnej szerokości.
- `safe-area-inset-*` dla iOS.
- Dialog ma poprawny scroll pionowy przy niskim ekranie.
- Visual smoke minimum: 320×568, 360×800, 390×844, 430×932.
- Nie ruszaj zasady logowania: **panel pracownika WWW tylko kodem**.

### Rola TECHNICIAN / serwisant

- Serwisant ma móc w aplikacji Windows wygenerować kod „Połącz urządzenie / kod do strony”.
- Kod ma być jednorazowy, krótko ważny i po redeem przenosić dokładnie rolę, punkty oraz dodatkowe uprawnienia pracownika.
- Zweryfikuj end-to-end dla TECHNICIAN, USER, COORDINATOR, OWNER.
- Nie wprowadzaj osobnego Google loginu dla pracownika WWW.

### Pliki startowe

- repo `LokosPL/lockon-serviceos-site`
- `assets/web-polish.css`
- `index.html` / kod dialogu logowania
- JS obsługujący `/website/redeem`
- Hub: `createWebsiteAuthCode`, `/website/redeem`, `HelpChat.tsx`

---

## PRIORYTET 1A — Serwis: części, FV zakupu i kalkulator wyceny

### Braki

W zleceniu jest obecnie tylko `estimated_cost` i `final_cost`. Brakuje:
- kosztu części;
- informacji czy jest faktura zakupu części;
- numeru/dostawcy faktury;
- kalkulatora wyceny.

### Model danych

Preferowane osobne rekordy części, nie jedno pole tekstowe:

`service_order_parts`
- `id`
- `service_order_id`
- `description`
- `quantity`
- `unit_cost_gross`
- `invoice_received boolean`
- `invoice_number nullable`
- `supplier nullable`
- `purchased_at nullable`
- `created_by_user_id`
- timestamps

Jeżeli podczas implementacji okaże się, że potrzebne są VAT/netto, dodaj je spójnie, ale nie komplikuj bez potrzeby. „FV za części” ma znaczyć **fakturę zakupu części**, nie fakturę sprzedaży dla klienta.

### Kalkulator

Na karcie zlecenia dla uprawnionych:
- suma kosztów części;
- robocizna / cena pracy;
- inne koszty opcjonalne;
- sugerowana cena klienta;
- cena orientacyjna;
- cena końcowa;
- marża informacyjna = cena klienta minus wewnętrzne koszty.

Zasady:
- wewnętrzny koszt części i marża nigdy nie trafiają do klienta ani do publicznej karty;
- USER nie widzi kosztów;
- OWNER/BOSS/COORDINATOR/TECHNICIAN zgodnie z obecnym modelem kosztów;
- desktop i PWA mają ten sam model i obliczenia;
- backend jest źródłem prawdy, nie tylko JS w UI.

### UX

- Sekcja „Wycena i części” w rozwiniętej karcie zlecenia.
- Dodaj/usuń część.
- Checkbox „Mam FV zakupu” odsłania numer faktury i dostawcę.
- Czytelne podsumowanie kalkulatora.
- Nie mieszaj tego z klientowskim modułem „Wyceny klientów” — to są dwie różne rzeczy.

---

## PRIORYTET 1B — Miasto obok nazwy punktu w całym ServiceOS

### Cel

Każdy punkt ma być rozpoznawalny bez zgadywania. Sama nazwa typu „Sklep LockOn” nie wystarcza.

### Jedna reguła display

Wprowadź wspólny helper, np.:
- frontend: `pointDisplayName(name, city)`
- backend/mail: analogiczny helper

Format preferowany:
`Nazwa punktu · Miasto`

Jeśli miasto jest puste, pokazuj samą nazwę. Nie duplikuj miasta, jeśli nazwa już kończy się dokładnie tym samym miastem.

### Gdzie musi być poprawione

- Sidebar i aktualny punkt aplikacji;
- Dashboard;
- Serwis: karty, dropdowny, punkt macierzysty, lokalizacja aktualna;
- Przekazania i selektory celu;
- Administracja i lista punktów;
- Rozliczenia;
- Wsparcie / tickety;
- Centrum klienta;
- ustawienia/powiadomienia Gmail;
- panel WWW/PWA;
- portal klienta;
- publiczna karta śledzenia;
- wszystkie e-maile operacyjne i klientowskie.

Nie rób kilkunastu ręcznych konkatenacji. Zcentralizuj formatowanie.

---

## PRIORYTET 1C — E-maile: punkt zawsze z miastem

### Problem

W mailu „Gotowe do odbioru” widać np.:
- „Punkt prowadzący: Sklep LockOn”
- „Kontakt / lokalizacja operacyjna: Sklep LockOn”

Brakuje miasta.

### Wymagania

Każda wiadomość związana z punktem ma używać pełnego labelu:
- punkt prowadzący;
- aktualna lokalizacja;
- punkt macierzysty;
- serwis docelowy;
- miejsce odbioru;
- powrót z zewnętrznego serwisu.

Przykład:
`Sklep LockOn · Nowogard`

Dotyczy HTML i text fallback.

Sprawdź zapytania SQL generujące dane do:
- `renderStatusEmail`;
- transferów;
- przyjęcia zlecenia;
- wiadomości portalu klienta;
- kodu klienta, jeśli mail wskazuje punkt.

Nie zapisuj miasta jako tekstu w payloadzie „na zawsze”, jeśli można je bezpiecznie pobrać z `points`; unikaj rozjazdów po zmianie miasta.

---

## PRIORYTET 2 — Audyt logistyki całej aplikacji

Przejdź przez pełne flow i usuń sprzeczności, bez kasowania istniejących invariantów:

1. przyjęcie urządzenia;
2. diagnoza;
3. części i wycena;
4. naprawa;
5. zewnętrzny serwis / transfer;
6. powrót do punktu macierzystego;
7. `REPAIR_DONE`;
8. `READY`;
9. odbiór;
10. `COMPLETED`;
11. anulowanie / odrzucenie / reklamacja.

Sprawdź role dla każdej akcji i każdy ekran desktop/PWA. Backend ma blokować niedozwolone przejścia nawet przy ręcznym request.

Dodaj testy scenariuszowe:
- lokalna naprawa;
- Nowogard → obcy serwis → Nowogard;
- transfer-only;
- brak części;
- część z FV / bez FV;
- anulowanie;
- USER vs TECHNICIAN vs SUPPORT vs OWNER.

---

## PRIORYTET 3 — Przegląd bezpieczeństwa end-to-end

Nie ograniczaj się do CodeQL. Przejdź praktycznie przez:

### Auth / sesje
- TTL i absolute TTL;
- unieważnianie po blokadzie;
- logout-all;
- code redeem single-use;
- customer portal CODE/GOOGLE;
- OAuth audience/state/PKCE;
- brak możliwości self-escalation ról.

### Publiczne endpointy
- rate limit / throttling dla kodów, loginów i publicznych tokenów;
- ochrona przed brute-force kodu klienta i kodu pracownika;
- jednolite komunikaty, żeby nie ujawniać zbędnych informacji o kontach;
- limity body i długości pól.

### Uprawnienia
- test macierzy każdej roli na API;
- `support_enabled` nie może omijać ograniczeń poza funkcjami wsparcia;
- koszty części/marża tylko dla uprawnionych;
- klient nigdy nie widzi notatek wewnętrznych i kosztów zakupu.

### Web / Electron
- CSP/CORS;
- `contextIsolation=true`, `sandbox`, `nodeIntegration=false`;
- walidacja IPC;
- brak sekretów w rendererze / bundle strony;
- bezpieczne otwieranie zewnętrznych URL;
- XSS w wiadomościach klienta, notatkach, nazwach punktów i e-mailach.

### Dane / audyt
- zapytania parametryzowane;
- migracje addytywne i rollback plan;
- audyt zmian finansowych, części, blokad, ról i wsparcia;
- brak PII w logach technicznych ponad potrzebę.

### CI
- Verify;
- CodeQL;
- npm audit;
- testy API ról;
- smoke na temp Neon;
- dopiero potem production deploy i release.

---

# Kolejność wdrażania i zasady release

Dla każdej większej paczki:

1. Aktualny stan GitHub/Neon.
2. Osobna branch feature/fix.
3. Jeśli DB: addytywna migracja + temp Neon branch z kopią danych.
4. Testy lokalne/CI.
5. Temp Neon deploy dokładnie tego bundle.
6. Smoke bez destrukcyjnych operacji.
7. PR i zielone checks.
8. Merge.
9. Production Neon deploy.
10. Production smoke.
11. Site deploy / desktop release tylko jeśli dana zmiana tego wymaga.
12. Zaktualizuj `PROJECT_HANDOFF.md` i ten plik.

Nie wdrażaj na produkcji nieweryfikowanego bundle. Nie rób factory reset ani kasowania danych jako smoke.

## Kryterium jakości

Zmiana nie jest skończona, jeśli działa tylko w UI. Musi być:
- poprawna logicznie;
- egzekwowana backendowo;
- spójna desktop + WWW/PWA tam, gdzie funkcja występuje;
- bezpieczna;
- przetestowana;
- wdrożona i sprawdzona smoke testem.
