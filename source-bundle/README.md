# LockOn ServiceOS source bundle

Pliki `part00.b64`–`part09.b64` tworzą po połączeniu zakodowane Base64 archiwum `tar.gz` kompletnego źródła LockOn ServiceOS 0.5.0 używanego przez automatyczny pipeline wydaniowy.

Workflow sprawdza SHA-256 archiwum przed budowaniem:

`1ee50c9e2f70411efaaa5d09fe29ff2e44afa8d0e84c86bc04b860b3d3d96fae`

Google OAuth Client Secret **nie znajduje się w tym archiwum**. Jest wstrzykiwany wyłącznie podczas GitHub Actions z repozytoryjnego sekretu `LOCKON_GOOGLE_CLIENT_SECRET`.
