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

Stan w chwili zapisania tego handoffu:
- `main`: `5fc803138521e24e557878271b75543b46ab6db7`
- publiczny release: `v0.10.0`
- PR #21: zamknięty / scalony
- aktywny Neon deployment: v15
- GitHub Pages: `app.serviceos.pl`, DNS OK, Enforce HTTPS aktywne
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
- statusy naprawy
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
- osobne maile logistyczne: wysłano do serwisu / dostarczono / serwisant przyjął / odrzucono / anulowano

### WWW / PWA
- landing page na `app.serviceos.pl`
- logowanie kodem z aplikacji w prawym górnym rogu
- `panel.html` jako mobilny panel
- PWA + service worker
- mobilne: nowe zlecenie, zlecenia, status, notatki, transfery, administracja OWNER

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

# PRIORYTETY NASTĘPNEJ SESJI — ZACZNIJ OD TEGO

## 1. Punkt macierzysty telefonu i obowiązkowy powrót z serwisu

To jest NAJWAŻNIEJSZE.

Punkt, w którym klient pierwotnie oddał telefon, jest **punktem macierzystym zlecenia / urządzenia**.

Założenie biznesowe:
- klient oddaje urządzenie w punkcie macierzystym;
- punkt może wysłać telefon do innego punktu-serwisu;
- docelowy serwis tylko realizuje naprawę;
- po zakończeniu naprawy serwis **musi odesłać urządzenie do punktu macierzystego**;
- klient odbiera urządzenie w punkcie macierzystym, nie w zewnętrznym serwisie.

Należy przebudować logistykę tak, aby:
- zlecenie miało trwałe `home_point_id` / równoważną jednoznaczną semantykę;
- outbound transfer do serwisu nie zmieniał punktu macierzystego;
- po ACCEPTED w zewnętrznym serwisie pojawiała się później obowiązkowa akcja „Odeślij do punktu macierzystego”;
- zwrot miał własny etap: wysłano z serwisu -> dostarczono do punktu macierzystego -> punkt macierzysty przyjął zwrot;
- zewnętrzny serwis nie mógł finalnie zakończyć przepływu klienta tak, jakby urządzenie miało zostać odebrane tam;
- READY / odbiór przez klienta powinien być możliwy dopiero po powrocie urządzenia do punktu macierzystego, jeśli zlecenie było wysyłane do zewnętrznego serwisu;
- interfejs desktop i mobile jasno pokazywał „Punkt macierzysty” i aktualną fizyczną lokalizację urządzenia.

Zmień również e-maile dla klienta:
- „Urządzenie wysłano z punktu X do serwisu Y”
- „Urządzenie dotarło do serwisu Y”
- „Serwisant w Y przyjął urządzenie”
- „Naprawa została zakończona i urządzenie wraca do punktu X”
- „Urządzenie dotarło z powrotem do punktu X”
- dopiero potem „Urządzenie jest gotowe do odbioru w punkcie X”

Nie mieszaj statusu naprawy z fizyczną logistyką urządzenia.

## 2. Gmail ma być automatyczny i niewidoczny, jeśli już działa

Użytkownik nie chce stale widzieć na górze „Połącz Gmail”.

Docelowy UX:
- po zalogowaniu ServiceOS automatycznie sprawdza połączenie Gmail;
- jeśli punkt ma aktywnego kompletnego nadawcę, niczego nie pokazuje — Gmail po prostu działa;
- jeśli refresh token / zgoda już istnieją, nie wymagaj ponownego klikania;
- jeśli zgoda rzeczywiście wygasła lub została cofnięta, dopiero wtedy pokaż jedno czytelne wezwanie do ponownej autoryzacji;
- przy pierwszej wymaganej zgodzie prowadź użytkownika przez spójny flow Google;
- po udanym połączeniu przycisk/banner znika;
- nie omijaj obowiązkowej zgody Google, ale nie pokazuj technicznych elementów, gdy nie są potrzebne.

Sprawdź obecne onboarding/bannery w `ServicePage` i po logowaniu.

## 3. Porządek i stopniowanie zleceń — „co robimy dalej”

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

## 4. TECHNICIAN przypisany do punktu automatycznie czyni punkt celem przekazania

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

## 5. OWNER: „Wymaż całą bazę danych”

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
4. Zacznij od priorytetu **1 — punkt macierzysty i obowiązkowy zwrot urządzenia**.
5. Wykonuj zmiany samodzielnie przez GitHub/Neon i dopiero przy koniecznej ręcznej czynności poproś użytkownika o jeden krok.
