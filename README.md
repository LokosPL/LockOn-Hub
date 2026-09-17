# LockOn ServiceOS 0.5.0

Desktopowy system dla serwisu telefonów: Electron + React + TypeScript z Google OAuth, autologowaniem, wbudowaną przeglądarką Chromium, rolami, centralnym panelem akceptacji użytkowników i rozliczeniami 50/50.

## Uruchomienie

```bash
npm install
npm run dev
```

`npm run dev` uruchamia równocześnie API (`127.0.0.1:8787`), Vite i Electron.

## Nowy przepływ konta

1. Użytkownik loguje się przez Google.
2. Przy pierwszym wejściu wpisuje nazwę punktu i miasto.
3. Wybiera rolę, o którą prosi: `BOSS`, `COORDINATOR`, `SUPPORT`, `TECHNICIAN` albo `USER`.
4. Konto pozostaje `PENDING` — użytkownik nie ma jeszcze dostępu do danych punktu.
5. Właściciel `nowogar@gmail.com` widzi zgłoszenie w **Administracja → Do akceptacji**.
6. Właściciel może zaakceptować proponowaną rolę, zmienić ją, przypisać zgłoszony punkt lub wybrać istniejący punkt.
7. Ekran oczekiwania sprawdza status automatycznie. Po akceptacji użytkownik przechodzi do aplikacji bez ponownego logowania Google.

Nie ma już pola „wiadomość dla właściciela”. Zgłoszenie jest krótkie i jednoznaczne: konto Google + punkt + miasto + żądana rola.

## Autologowanie

Po udanym logowaniu aplikacja zapisuje lokalnie sesję LockOn API. Backend utrzymuje sesję w trybie sliding do 90 dni. Przy kolejnym uruchomieniu aplikacja najpierw próbuje odtworzyć sesję i — jeśli nadal jest ważna — nie uruchamia ponownie OAuth Google.

Wylogowanie ręczne usuwa lokalną sesję.

## Panel właściciela

Panel **Administracja** ma trzy czytelne zakładki:

- **Do akceptacji** — nowe zgłoszenia z proponowaną rolą i punktem,
- **Aktywne konta** — zmiana ról i przypisanych punktów,
- **Dziennik logowań** — kto i kiedy logował się do aplikacji.

Panel odświeża się automatycznie co 10 sekund. Można też wyszukiwać po imieniu, e-mailu i punkcie.

Role:

- `OWNER` — Właściciel aplikacji, globalny pełny dostęp,
- `BOSS` — Szef, globalny dostęp do wszystkich punktów i rozliczeń,
- `COORDINATOR` — Koordynator wybranych punktów,
- `SUPPORT` — Wsparcie LockOnOS wybranych punktów,
- `TECHNICIAN` — Serwisant,
- `USER` — podstawowy Użytkownik punktu.

## Rozliczenia 50/50

Serwisant sam wpisuje kwotę przychodu, datę, punkt i notatkę. Zgłoszenie ma status `PENDING`. OWNER lub BOSS może je zatwierdzić albo odrzucić. Po zatwierdzeniu backend zawsze liczy 50% dla Serwisanta i 50% dla Szefa.

## Google OAuth

Client ID jest w `electron/appConfig.ts`. Client Secret nie jest dołączony do projektu. Development może odczytać plik `client_secret_*.apps.googleusercontent.com.json` z katalogu projektu lub `Pobrane`, albo zmienną `LOCKON_GOOGLE_CLIENT_SECRET`.

## Backend i wiele komputerów

Katalog `server/` zawiera działający prototyp API oparty na pliku JSON. Lokalnie wystarcza do testów całego przepływu. Aby OWNER widział logowania i użytkowników z różnych komputerów, API musi być uruchomione pod jednym wspólnym publicznym adresem. Wszystkie aplikacje muszą wskazywać ten sam `LOCKON_API_URL`.

Przed wdrożeniem produkcyjnym zalecane jest zastąpienie pliku JSON bazą PostgreSQL, HTTPS/reverse proxy, rotacja ujawnionych wcześniej danych OAuth oraz backupy.
