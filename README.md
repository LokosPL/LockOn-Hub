# LockOn ServiceOS

LockOn ServiceOS to otwartoźródłowa aplikacja desktopowa dla Windows do codziennej pracy serwisu. Obecny zakres projektu obejmuje pulpit, logowanie Google, role i dostęp do punktów, administrację, rozliczenia, wbudowaną przeglądarkę, pomoc oraz automatyczne aktualizacje.

**Autor i maintainer:** Bartłomiej Motłoch  
**Repozytorium:** https://github.com/LokosPL/LockOn-Hub

## Pobieranie

Oficjalne wydania Windows są publikowane wyłącznie w:

https://github.com/LokosPL/LockOn-Hub/releases

Główny instalator ma nazwę:

`LockOn-ServiceOS-Setup.exe`

Każde wydanie zawiera również metadane aktualizatora, SHA-256 i GitHub Artifact Attestations.

## Aktualizacje

Aplikacja korzysta z `electron-updater` oraz GitHub Releases.

Od wersji 0.6.4 aktualizacja:
- jest sprawdzana automatycznie,
- pobiera się w tle,
- zachowuje bieżący katalog instalacji,
- instaluje się bez ponownego przechodzenia przez kreator,
- uruchamia ServiceOS ponownie po aktualizacji.

## Bezpieczeństwo

Projekt używa między innymi:
- Electron sandbox i `contextIsolation`,
- ograniczonego IPC,
- CSP,
- izolowanej sesji wbudowanej przeglądarki,
- PKCE + `state` dla Google OAuth,
- weryfikacji Google ID token po stronie API,
- szyfrowanego lokalnego tokena sesji, gdy systemowy magazyn jest dostępny,
- hashowanych sesji API,
- CodeQL,
- Dependabot,
- `npm audit`,
- przypiętych wersji GitHub Actions,
- SHA-256 i GitHub Artifact Attestations dla wydań.

Zasady zgłaszania podatności: [SECURITY.md](SECURITY.md).

## Code signing policy

**Free code signing provided by SignPath.io, certificate by SignPath Foundation.**

Wniosek do darmowego programu Open Source SignPath Foundation został wysłany i oczekuje na akceptację. Do czasu uzyskania podpisu Windows Smart App Control może blokować niepodpisane buildy.

Pełna polityka, role i zasady podpisywania: [CODE_SIGNING.md](CODE_SIGNING.md).

## Prywatność

Polityka prywatności:

https://lokospl.github.io/lockon-serviceos-site/privacy.html

Podstawowe logowanie Google korzysta tylko z `openid email profile`; aplikacja nie potrzebuje treści Gmaila ani Google Drive do uwierzytelnienia.

## Budowanie

Wymagany jest Node.js 22.

```bash
npm ci
npm run typecheck
npm run build
```

Pakiet Windows:

```bash
npx electron-builder --win --publish never
```

Oficjalne wydania są budowane przez GitHub Actions na GitHub-hosted runners.

## Wydawanie

Plik `RELEASE_VERSION` musi być zgodny z wersją w `package.json`. Zmiana `RELEASE_VERSION` uruchamia workflow wydania, który wykonuje audit zależności, buduje instalator, generuje sumy SHA-256, generuje provenance i publikuje GitHub Release.

Po akceptacji przez SignPath Foundation workflow zostanie rozszerzony o podpisywanie artefaktu pochodzącego bezpośrednio z GitHub Actions. Przygotowany szablon znajduje się w [docs/SIGNPATH_SETUP.md](docs/SIGNPATH_SETUP.md).

## Licencja

LockOn ServiceOS jest udostępniany na licencji [MIT](LICENSE).

Zasady współpracy: [CONTRIBUTING.md](CONTRIBUTING.md).


## Aktualna wersja

**0.6.6**
