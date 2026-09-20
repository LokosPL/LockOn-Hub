# LockOn ServiceOS 1.0.0.0 — definicja wydania i handoff

> Dokument operacyjny dla kolejnego chatu. Użytkownik w nowym czacie udostępnia GitHub + Neon i pisze tylko **START**. Wtedy należy od razu pracować, nie opisywać planu.

## 1. Cel końcowy

Dowieźć **LockOn ServiceOS 1.0.0.0** jako kompletne, spójne wydanie produkcyjne:

- aplikacja Windows/Electron;
- centralne API w Neon;
- baza Neon i migracje;
- strona WWW/PWA pracownika;
- portal klienta;
- e-maile;
- karty serwisowe PDF i QR;
- logistyka między punktami;
- części, koszty i faktury zakupowe;
- workspace serwisanta;
- role i uprawnienia;
- wsparcie bot + konsultant;
- updater i finalny installer Windows.

Nie publikować 1.0.0.0, dopóki testy, smoke, migracja, produkcyjne API, Pages i Windows release nie są zielone.

## 2. Aktualny stan — 2026-09-20 około 20:28 Europe/Warsaw

### Hub

Repo: `LokosPL/LockOn-Hub`

- `main`: `58eb4f009e92327297a6d0a4f20db198b27b3fa8`
- aktualne publiczne wydanie: **v0.20.5**
- `package.json`: `0.20.5`
- `RELEASE_VERSION`: `0.20.5`
- najnowszy instalator v0.20.5 SHA-256:
  `f4f776475e3ad3f51e4314bbabd9ec8c34076ee89bb988738bb99299226d51cf`

Aktywna gałąź nowego wydania:
- `feature/v0.21-service-finance-invoices`
- HEAD: `3234a995921527f48446fa98c54eb321fcb91ac6`
- Verify LockOn ServiceOS #643: **SUCCESS**
- bundle API wcześniejszego HEAD #201: **SUCCESS**

Ta gałąź zawiera już wcześniejsze prace v0.21 oraz nowy fundament 1.0 opisany niżej. Nie porzucaj jej i nie implementuj tego od nowa.

### Site / PWA

Repo: `LokosPL/lockon-serviceos-site`

- `main`: `08deb9d94fa6a0a8a75fc2b480a8bd429c797ca6`
- aktywna gałąź 1.0:
  `release/1.0.0.0-serviceos`
- HEAD przy handoff:
  `a61eb27276119b9f719b26218c6959bdb6371b2d`

Ostatni verify na tym HEAD: **FAIL**, ale JavaScript syntax jest zielony. Aktualny znany powód to przestarzały kontrakt grep w `.github/workflows/verify.yml`: test nadal oczekuje:
`advanced = ['quotes','earnings','admin','scan']`,
a kod po dodaniu workspace/faktur ma też `workspace`, `tech-notes`, `invoices`.
Najpierw popraw verify do aktualnego kontraktu i uruchom ponownie. Nie maskuj realnych błędów.

### Neon produkcja

Project:
- `wandering-field-13057181`

Produkcja:
- branch `br-steep-bonus-b1f1qh8u`
- DB `lockon`
- function `lockonapi`
- aktywny deployment: **v38**, completed
- runtime Node.js 24

**Nowa migracja 1.0 i nowe API kart serwisowych NIE są jeszcze wdrożone na produkcję.**
Nie zakładaj, że produkcja ma kod z gałęzi 1.0.

W projekcie istnieje kilka branchy testowych. Między innymi:
- `br-spring-pond-b1hqe48m` / `verify-hotfix-v0204`
- `br-frosty-shadow-b17elnrj`
- `br-tiny-bar-b1w5axxk`
- inne historyczne branche testowe.

Nie usuwaj branchy Neon bez sprawdzenia, czy są nadal potrzebne; nie usuwaj produkcji.

## 3. Co jest już zaimplementowane na Hub branch 1.0

### Karty serwisowe i QR

Dodano migrację:
`database/migrations/2026-09-20-v1000-service-cards.sql`

Dodano tabelę:
`service_order_cards`

Ma przechowywać:
- identyfikator zlecenia;
- tryb wydruku;
- zaszyfrowany token QR pracownika;
- zaszyfrowany krótki kod pracownika;
- hashe tokenów/kodów;
- informacje o wydruku;
- wysłaniu e-maila klientowi;
- ostatnim skanie.

`handling_mode` rozszerzono o:
- `STANDARD`
- `COMPLAINT_FLOW`
- historyczne `TRANSFER_ONLY`

Nowe zlecenia nie mają już ręcznie wybieranego `TRANSFER_ONLY`.
Backend sam ustala:
- REPAIR → `STANDARD`
- COMPLAINT → `COMPLAINT_FLOW`

### PDF

`functions/lockon-api.mjs` używa pdfmake.

Docelowo są trzy warianty:
- `PHYSICAL` — A4 poziomo, lewa część karta urządzenia, prawa część karta klienta, linia cięcia;
- `DEVICE` — karta urządzenia;
- `CUSTOMER` — karta klienta.

Karta urządzenia:
- numer zlecenia;
- punkt;
- klient;
- telefon/model/IMEI/serial;
- opis;
- kod `SV-XXXX-XXXX`;
- QR pracownika.

Karta klienta:
- dane zlecenia;
- kod klienta;
- QR prowadzący do `klient.html#code=...&order=...&auto=1`;
- kod ma logować klienta automatycznie, bez ręcznego przepisywania.

### E-mail przy przyjęciu

Przyjęcie zlecenia wymaga obecnie na branchu:
- e-mail klienta;
- telefonu klienta.

Tworzony jest `SERVICE_INTAKE_CARD`.
Karta klienta PDF ma być załącznikiem.
Link w mailu używa auto-login QR/URL.

To jest dokument operacyjny przyjęcia i ma być wysyłany **zawsze**, niezależnie od opcjonalnych preferencji statusowych. Jeśli Gmail jest chwilowo niedostępny, wysyłka ma pozostać do retry; nie wolno zgubić dokumentu.

### Endpointy kart/skanowania

Dodane na branchu:
- `POST /service/orders/:id/service-card`
- `POST /service/scan`
- `GET /public/customer-portal/orders/:id/service-card`

Skan pracownika:
- wymaga zalogowanej sesji pracownika;
- wymaga aktywnego punktu;
- może użyć QR tokenu albo kodu `SV-XXXX-XXXX`;
- nie przyjmuje urządzenia do złego punktu;
- jeśli istnieje transfer do aktywnego punktu, przyjmuje go;
- przy powrocie do punktu macierzystego i statusie `REPAIR_DONE` może automatycznie ustawić `READY`;
- zapisuje audyt.

### Desktop

Dodane:
- IPC `service:openServiceCard`
- IPC `service:scanServiceCard`
- natywne otwieranie wygenerowanego PDF w Windows;
- wybór po utworzeniu zlecenia:
  - „A4 · fizyczna + online”
  - „Tylko online”
- ponowny wydruk z karty zlecenia;
- formularz przyjęcia nie pokazuje ręcznego punktu/handling mode jako decyzji użytkownika;
- punkt wynika z aktywnego punktu;
- handling mode wynika z typu zlecenia;
- e-mail i telefon są wymagane.

### Local backend

`server/index.mjs` został częściowo zsynchronizowany z automatycznym handling mode i wymaganiem e-mail + telefon.
Przed release trzeba dopilnować, by fallback/local backend nie rozjeżdżał kontraktów centralnego API, albo jasno ograniczyć go tylko do funkcji, które rzeczywiście obsługuje.

## 4. Co jest już zaimplementowane na Site branch 1.0

### Portal klienta

`assets/customer-portal.js`:
- czyta hash QR `#code=...&order=...&auto=1`;
- automatycznie wykonuje login kodem;
- usuwa kod z URL po użyciu;
- otwiera/fokusuje właściwe zlecenie;
- klient może pobrać swoją kartę serwisową PDF z poziomu zlecenia.

### PWA pracownika — intake

`panel.html` / `assets/panel.js`:
- e-mail i telefon klienta wymagane;
- usunięto ręczny wybór „Sposób obsługi”;
- aktywny punkt i typ naprawy/reklamacji wyznaczają flow;
- po utworzeniu zlecenia otwiera się obowiązkowy wybór karty;
- PDF otwierany jest w przeglądarce / pobierany;
- istnieje reprint karty z detali zlecenia.

### PWA — skaner urządzenia

Dodano widok `view-scan`:
- uruchomienie aparatu;
- `BarcodeDetector`, jeśli dostępny;
- fallback do zwykłego aparatu telefonu przez wejście z QR deep-link;
- ręczny kod `SV-XXXX-XXXX`;
- scan URL zapisuje token, także jeśli użytkownik musi najpierw się zalogować;
- po zalogowaniu PWA kontynuuje skan;
- wywołuje `POST /service/scan`;
- po udanym skanie odświeża orders/transfers i otwiera zlecenie.

### PWA — workspace serwisanta / faktury

Na branchu rozpoczęto parity z desktopem:
- widok `workspace` dla TECHNICIAN;
- 7-dniowy plan pracy;
- kolejki „czeka na części”, „gotowe”, „bez terminu”;
- widok prywatnych notatek serwisanta;
- magazyn faktur per miesiąc;
- pobieranie pojedynczej faktury;
- batch download miesiąca;
- monthly prompt;
- sekcja kosztów/części/faktur wewnątrz zlecenia;
- upload faktury PDF przez presigned URL;
- SHA-256 pliku przed uploadem.

CSP panelu został rozszerzony wyłącznie o host Neon Storage.

Ta część jest **świeża i nie jest jeszcze zweryfikowana pełnym CI/E2E**. Traktuj ją jako kod do dokończenia, nie jako gotowy release.

## 5. Najważniejsze wymaganie użytkownika dla 1.0.0.0

### Prosty polski język

Cały produkt ma być zrozumiały dla pracownika sklepu/serwisu bez wiedzy technicznej.

Przejdź przez:
- Windows;
- PWA;
- portal klienta;
- e-maile;
- PDF-y;
- modale;
- przyciski;
- błędy;
- statusy;
- role;
- ustawienia.

Zasady copy:
- krótko;
- po polsku;
- jednoznacznie;
- najpierw „co mam zrobić”, potem szczegóły;
- nie używaj surowych nazw API, enumów, `handling_mode`, `TRANSFER_ONLY`, `SERVICE_INTAKE_CARD` w UI;
- błędy mają mówić co się stało i co użytkownik może zrobić;
- „Zapisz”, „Przyjmij urządzenie”, „Wyślij do serwisu”, „Odeślij do punktu”, „Pobierz kartę” zamiast technicznego żargonu;
- statusy i etapy tłumaczyć konsekwentnie.

### Lejek użytkownika

Każdy ekran ma prowadzić użytkownika do następnej logicznej czynności:
1. wybierz/rozpoznaj sprawę;
2. wpisz tylko dane, które są potrzebne;
3. główna akcja jest jedna i oczywista;
4. po sukcesie wiadomo dokładnie, co dalej;
5. akcje rzadkie są niżej / w szczegółach.

Nie dodawaj zbędnych wyborów, jeśli system zna odpowiedź sam.

## 6. Jednolity styl bez redesignu

Użytkownik nie chce nowego projektu graficznego. Ma zostać obecny charakter LockOn/ServiceOS.

Trzeba jednak ujednolicić istniejące elementy:
- primary / secondary / danger / ghost button;
- mały przycisk w kartach;
- card / section card;
- modal/dialog;
- input/select/textarea;
- badge/status;
- empty/loading/error/success state;
- odstępy i promienie;
- fokus klawiatury;
- disabled/hover/active.

Windows, PWA, portal klienta i e-maile/PDF mają wyglądać jak jedna rodzina produktu.

Nie przebudowuj brandingu. Napraw niespójności.

## 7. Role — docelowo wszystkie opisane po polsku i egzekwowane backendowo

Nazwy dla ludzi:
- OWNER → **Właściciel**
- BOSS → **Kierownik**
- COORDINATOR → **Koordynator**
- SUPPORT → **Wsparcie / konsultant**
- TECHNICIAN → **Serwisant**
- USER → **Pracownik**

Docelowy sens ról, który trzeba zweryfikować z backendem i doprowadzić do spójności:

### Właściciel
- pełna administracja;
- użytkownicy, blokady, punkty;
- audyt;
- finanse;
- serwis;
- koszty/faktury;
- wsparcie dla innych użytkowników;
- nie może przejąć własnego ticketu wsparcia.

### Kierownik
- operacyjne zarządzanie przypisanymi punktami;
- zlecenia, transfery, koszty/faktury, rozliczenia zgodnie z backendem;
- bez globalnych funkcji tylko dla OWNER.

### Koordynator
- koordynacja operacyjna;
- zlecenia, technicy, transfery, koszty/faktury w swoim zakresie;
- bez globalnej administracji OWNER.

### Wsparcie / konsultant
- czyta dane potrzebne do pomocy;
- obsługuje tickety wsparcia, jeśli ma support_enabled / rolę;
- nie dostaje automatycznie uprawnień do kosztów, zmian statusów ani administracji tylko dlatego, że jest SUPPORT.

### Serwisant
- przyjmuje i obsługuje zlecenia;
- statusy, naprawa, części, koszty i faktury w swoim zakresie;
- transfery;
- własny plan pracy;
- prywatne notatki;
- własne rozliczenia;
- brak globalnej administracji.

### Pracownik
- może przyjąć urządzenie;
- może zobaczyć zlecenia w swoim zakresie;
- może wykonać bezpieczne akcje logistyczne przewidziane przez backend;
- nie widzi wewnętrznych kosztów, marży, prywatnych notatek ani administracji;
- nie może sam eskalować roli.

**API jest źródłem prawdy.** Nie wystarczy ukryć przycisków.

Przed release przygotuj test macierzy ról dla kluczowych endpointów i UI.

## 8. Funkcje, które 1.0 musi domknąć

### Serwis
- przyjęcie naprawy;
- reklamacja;
- diagnoza;
- części;
- faktura zakupu PDF;
- kalkulator kosztów;
- robocizna;
- cena orientacyjna;
- cena końcowa;
- marża tylko wewnętrzna;
- notatki wewnętrzne;
- historia;
- technik;
- termin;
- anulowanie;
- gotowe do odbioru;
- zakończenie.

### Logistyka
- punkt macierzysty;
- aktualna lokalizacja;
- transfer do zewnętrznego serwisu;
- powrót;
- skan QR / kod;
- brak możliwości przyjęcia do złego punktu;
- audyt każdej zmiany;
- spójne maile do klienta.

### Klient
- kod klienta;
- auto-login QR bez ręcznego wpisywania kodu;
- Google jako opcjonalne pełne konto;
- zlecenia;
- status;
- wyceny;
- wiadomości;
- ustawienia dodatkowych powiadomień;
- karta serwisowa PDF dostępna w panelu;
- brak dostępu do kosztów zakupu, marży i notatek wewnętrznych.

### Pracownik WWW
- nadal logowanie **tylko kodem wygenerowanym z aplikacji**, bez osobnego Google logowania;
- zachowanie roli, punktów i support_enabled po redeem;
- PWA mobile-first;
- skaner QR;
- parity z kluczowymi funkcjami desktopu.

### Wsparcie
Stan z P0A ma zostać zachowany:
- bot działa zawsze;
- konsultant jest osobnym kanałem;
- użytkownik wybiera BOT/CONSULTANT;
- self-support blokowany;
- prywatne wiadomości BOT nie pojawiają się w SupportDesk.

## 9. E-maile i punkty

W każdym miejscu pokazującym punkt używać:
`Nazwa punktu · Miasto`
gdy miasto istnieje.

Dotyczy:
- Windows;
- PWA;
- klienta;
- PDF;
- maile;
- transfery;
- dashboard;
- finanse;
- wsparcie.

Zcentralizuj helper, nie rób dziesiątek różnych konkatenacji.

E-maile:
- wspólny layout;
- jasny temat;
- jedna główna akcja;
- wersja HTML + text;
- poprawne polskie treści;
- status dostawy/retry;
- karta klienta PDF przy przyjęciu zawsze.

## 10. Wydajność na słabszych laptopach — bez zmian wizualnych

Przed 1.0 zoptymalizuj aplikację Windows pod starsze/słabsze PC, **bez zmiany wyglądu**.

Sprawdź i popraw tylko tam, gdzie ma to realny efekt:
- zbędne rerendery React;
- duże listy i wielokrotne map/filter w renderze;
- ciężkie efekty uruchamiane przy każdej zmianie stanu;
- polling, który działa mimo niewidocznej zakładki;
- powtarzane requesty;
- ładowanie nieużywanych modułów;
- niepotrzebne animacje/timery;
- ciężkie box-shadow/backdrop-filter tylko jeśli można zachować ten sam wygląd przy tańszej implementacji;
- niepotrzebne procesy Electron;
- pamięć BrowserView/webContents;
- startup;
- pakiet lokalnego API;
- obsługa obrazów i PDF.

Wymagania:
- brak wizualnego regresu;
- brak usuwania funkcji;
- lazy/defer gdzie bezpieczne;
- ograniczenie pracy w tle;
- poprawne cleanup listenerów/timerów;
- `prefers-reduced-motion`;
- rozsądna pamięć po długiej pracy;
- sprawdzenie cold start i przełączania zakładek.

## 11. Kolejność pracy w następnym czacie

Po komendzie **START**:

1. Odczytaj ten dokument, `PROJECT_HANDOFF.md` i aktualny stan obu repo + Neon.
2. Nie pytaj użytkownika o rzeczy, które da się sprawdzić samemu.
3. Napraw site CI na branchu `release/1.0.0.0-serviceos`.
4. Dokończ i zweryfikuj PWA workspace/costing/invoices.
5. Dokończ pełną parity i copy/UX po polsku.
6. Dokończ wspólny styl istniejących button/card/form/modal bez redesignu.
7. Zrób role matrix + bezpieczeństwo.
8. Zrób performance pass Windows bez zmian wizualnych.
9. Na Hub branchu uruchom pełny final CI z aktualnego HEAD.
10. Utwórz/wykorzystaj bezpieczny branch Neon testowy, zastosuj migrację 1.0, wdroż dokładny bundle API z CI.
11. E2E na temp:
   - create REPAIR;
   - create COMPLAINT;
   - karta A4;
   - karta DEVICE;
   - customer auto-login QR;
   - customer download PDF;
   - staff QR/code scan;
   - wrong point blocked;
   - transfer outbound;
   - scan destination;
   - REPAIR_DONE;
   - RETURN_HOME;
   - scan home → READY;
   - intake email z PDF;
   - role matrix;
   - parts/costing;
   - invoice upload/download/batch;
   - technician workspace/notes;
   - bot + konsultant.
12. Nie testuj produkcji przez tworzenie sztucznych danych, jeśli można to zrobić na temp.
13. Gdy temp jest zielony:
   - PR Hub → main;
   - PR Site → main;
   - rozwiąż konflikty;
   - wszystkie required CI zielone.
14. Wdróż migrację i dokładnie ten sam zweryfikowany bundle API na produkcję.
15. Safe public smoke produkcji.
16. Sprawdź Pages po merge site.
17. Ustaw wersję Windows dokładnie **1.0.0.0**:
   - sprawdź czy obecny semver/electron-builder/updater akceptuje czteroczłonowy numer;
   - jeśli narzędzia wymagają semver 3-członowego, NIE udawaj. Zaimplementuj jawnie produktową wersję `1.0.0.0` przy zachowaniu kompatybilnego package/build version i opisz to w metadanych/release; preferuj technicznie poprawne rozwiązanie.
18. Zaktualizuj `package.json`, lockfile, `RELEASE_VERSION` i miejsca wyświetlające wersję spójnie.
19. Merge release PR.
20. Poczekaj na Windows release workflow.
21. Zweryfikuj:
   - release;
   - installer;
   - latest.yml;
   - blockmap;
   - SHA256SUMS;
   - updater;
   - final CodeQL/verify;
   - produkcyjny Neon deployment;
   - Pages.
22. Dopiero wtedy uznaj **1.0.0.0 wydane**.
23. Zaktualizuj `PROJECT_HANDOFF.md` oraz ten dokument na stan po release.

## 12. Gate wydania — niczego nie pomijaj

Wydanie jest gotowe dopiero gdy:
- Hub main ma finalny kod;
- Site main ma finalny kod;
- DB migration jest na prod;
- API prod ma finalny bundle;
- Pages jest finalne;
- instalator 1.0 działa;
- updater widzi 1.0;
- CI Hub zielone;
- CodeQL zielony;
- CI Site zielone;
- smoke API zielony;
- E2E głównych flow zielony;
- role sprawdzone;
- klient nie widzi danych wewnętrznych;
- support privacy zachowane;
- e-mail intake z PDF sprawdzony;
- QR klienta działa bez wpisywania kodu;
- QR pracownika nie działa anonimowo i nie może przyjąć urządzenia do złego punktu;
- faktury PDF działają desktop + PWA;
- brak znanych P0/P1;
- performance pass zrobiony;
- polskie copy i spójność UI zrobione.

## 13. Znane rzeczy, których nie wolno przypadkiem cofnąć

- portal pracownika WWW = code-only;
- portal klienta: kod = szybki dostęp, Google = pełne konto;
- bot działa także gdy konsultant jest JOINED;
- self-support zabroniony;
- prywatne BOT messages nie wyciekają do SupportDesk;
- koszty/marża nie trafiają do klienta;
- `READY` po zewnętrznym serwisie dopiero po prawidłowym powrocie do punktu macierzystego;
- nie przenoś urządzenia skanem bez właściwego transferu;
- sesje i role muszą być egzekwowane po stronie API;
- nie wkładaj sekretów do rendererów ani statycznej strony;
- wszystkie SQL parametryzowane.

## 14. Otwarte stare PR-y

Hub ma historyczne otwarte PR-y m.in. #28 i #9.
Site ma historyczne PR-y m.in. #31 i #5.

Nie merge'uj ich mechanicznie. Najpierw sprawdź, czy ich poprawki są już w main/branch 1.0. Po finalnym release można zamknąć superseded PR-y, jeśli są faktycznie zastąpione.

## 15. Sposób pracy kolejnego chatu

Użytkownik chce minimum gadania.

Po `START`:
- wykonuj;
- krótkie checkpointy;
- nie rozpisuj planu;
- nie pytaj o zgodę na zwykłe branche, commity, PR-y, testy, temp deploye;
- pytaj tylko o sekret, ręczną czynność właściciela albo nieodwracalną/destrukcyjną operację;
- nie proś o hasła/tokeny w czacie;
- jeśli CI wykryje błąd, napraw go, nie obchodź;
- nie kończ na „prawie gotowe” — celem jest wydane **1.0.0.0**.
