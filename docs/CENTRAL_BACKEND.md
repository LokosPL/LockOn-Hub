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

Employee WWW/PWA access is code-only. The public website does not authenticate employees directly with Google.

One-time website login codes use `website_auth_codes`:
- generated only for an already authenticated, active desktop session;
- cryptographically random value shown once;
- only SHA-256 hash stored;
- short TTL: 5 minutes;
- bound to one user and desktop session;
- single-use via `consumed_at`;
- redeemed through `POST /website/redeem`;
- `POST /auth/google-web` is intentionally disabled and returns `WEB_CODE_ONLY`.

## Email notifications

Do not store Gmail passwords or OAuth client secrets in Electron. Status mail is queued in `notification_outbox` and will be sent by a server-side worker/provider. Provider credentials remain server-side only.


## Notification worker

ServiceOS stores outgoing status emails in `notification_outbox`.

Delivery behavior:
- immediate send attempt after an eligible status change;
- delivery result and Gmail message ID are persisted;
- failures use exponential backoff;
- manual retry is available from the Service module;
- Neon Function Trigger `serviceos-notification-worker` invokes `/internal/notifications/process` every 5 minutes;
- the scheduled route accepts only Neon trigger calls carrying `X-Neon-Trigger-Invocation-Id`.

Per-point configuration lives in `point_notification_settings` and controls automatic delivery, enabled statuses, sender display name and footer text.
