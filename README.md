# LockOn ServiceOS

Oficjalne repozytorium aplikacji **LockOn ServiceOS**.

**Autor:** Bartłomiej Motłoch — Punkt Nowogard

## Pobieranie

Najnowszy instalator Windows będzie zawsze dostępny w sekcji **Releases** jako:

`LockOn-ServiceOS-Setup.exe`

Strona projektu korzysta ze stałego linku do najnowszego wydania, więc po publikacji nowej wersji użytkownicy nie muszą szukać nowego adresu.

## Aktualizacje

LockOn ServiceOS korzysta z **GitHub Releases** jako kanału aktualizacji. Każde wydanie zawiera metadane dla `electron-updater`, dzięki czemu zainstalowana aplikacja może wykryć nowszą wersję, pobrać ją i uruchomić instalację.

## Automatyczne wydania

Workflow `.github/workflows/release.yml`:

1. odtwarza pełne źródło aplikacji,
2. sprawdza integralność archiwum,
3. instaluje zależności,
4. wykonuje TypeScript typecheck,
5. buduje instalator Windows,
6. publikuje GitHub Release.

Do kompilacji logowania Google wymagany jest repozytoryjny sekret Actions o nazwie:

`LOCKON_GOOGLE_CLIENT_SECRET`

Sekret nie jest przechowywany w publicznym kodzie repozytorium.

## Wersja

Aktualna gałąź wydaniowa: **0.5.0**
