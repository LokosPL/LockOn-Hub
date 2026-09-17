# LockOn ServiceOS

Desktopowa aplikacja LockOn do codziennej pracy serwisu. Aktualny kierunek projektu to prosty, spójny interfejs oparty na funkcjach, które są już realnie dostępne: pulpit, wbudowana przeglądarka, logowanie Google, administracja dostępu, rozliczenia, pomoc oraz aktualizacje.

**Autor:** Bartłomiej Motłoch — Punkt Nowogard

## Pobieranie

Oficjalny instalator Windows jest publikowany w **GitHub Releases** jako:

`LockOn-ServiceOS-Setup.exe`

Stały link strony pobierania wskazuje zawsze na najnowsze wydanie.

## Aktualizacje

Aplikacja korzysta z `electron-updater` i GitHub Releases. Wydanie zawiera instalator, `latest.yml` oraz `.blockmap`, dzięki czemu ServiceOS może wykryć nową wersję i przeprowadzić aktualizację.

## Wydawanie

Kod aplikacji znajduje się bezpośrednio w repozytorium. Workflow wydania uruchamia się po zmianie pliku `RELEASE`, sprawdza zgodność wersji z `package.json`, buduje aplikację na Windows i publikuje release.

Sekret Google OAuth jest przechowywany jako GitHub Actions Secret:

`LOCKON_GOOGLE_CLIENT_SECRET`

Nie jest zapisywany w publicznym kodzie repozytorium.

## Weryfikacja

Każda zmiana źródła jest sprawdzana przez CI:
- TypeScript renderer,
- kompilacja Electron,
- build Vite.

## Aktualna wersja

**0.6.0**
