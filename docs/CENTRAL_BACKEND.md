# Central backend — Neon

## Current state

The production data model is provisioned in Neon project **LockOn ServiceOS**, region **AWS Europe Central 1 (Frankfurt)**, database `lockon`, branch `main`.

The desktop application must never receive a Neon connection string or database password. The target architecture is:

```
Electron renderer
  -> trusted IPC
Electron main
  -> HTTPS / Bearer session
Central API (Neon Function)
  -> DATABASE_URL injected server-side by Neon
PostgreSQL
```

The existing local JSON backend remains a compatibility/dev fallback until the central HTTPS API is deployed and verified.

## Service module

The first service workflow keeps the existing role/point model and introduces:
- customer reuse by normalized email or phone;
- device record per intake;
- REPAIR / COMPLAINT order types;
- point scoping on every operation;
- status history;
- auditability hooks.

## Website authorization

Planned one-time website login codes use `website_auth_codes`:
- cryptographically random value shown once;
- only SHA-256 hash stored;
- short TTL (target: 5 minutes);
- bound to one user and desktop session;
- single-use via `consumed_at`.

## Email notifications

Do not store Gmail passwords or OAuth client secrets in Electron. Status mail is queued in `notification_outbox` and will be sent by a server-side worker/provider. Provider credentials remain server-side only.
