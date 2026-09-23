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

Do not store Gmail passwords or OAuth refresh tokens in Electron. Customer service mail is queued in `notification_outbox`. The authoring employee is stored in `notification_outbox.user_id`, and delivery resolves the Gmail credential from `user_gmail_credentials.user_id`. There is no runtime fallback to another employee or to a point-level Gmail sender.

Google desktop login requests `gmail.send`; an active non-OWNER employee's encrypted refresh token is stored server-side for that employee. The renderer receives only connection state and the sender e-mail address, never the OAuth credential.

Internal meeting invitations are deliberately isolated from customer mail. They use `meeting_email_sender` and `meeting_email_outbox`; an OWNER/admin Gmail may be used there without becoming a sender for customer service messages.


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

## Meetings and LiveKit

Meeting business state remains in Postgres: `meetings`, `meeting_audience`, `meeting_registrations`, `meeting_participant_controls`, `meeting_attendance`, `meeting_events`, and the isolated meeting invitation outbox.

Audio and screen media do not pass through the REST API or Postgres. ServiceOS uses LiveKit as the WebRTC SFU/TURN layer. The backend creates short-lived room tokens and enforces meeting eligibility and publish permissions before returning a token to Electron.

Required backend-only environment variables:

```dotenv
LIVEKIT_URL=wss://<livekit-host>
LIVEKIT_API_KEY=<server-api-key>
LIVEKIT_API_SECRET=<server-api-secret>
```

Never expose `LIVEKIT_API_SECRET` to Electron or the renderer. Participants join muted. Camera publishing is not granted. Screen-share and microphone publish sources are granted according to meeting policy and persistent moderator overrides.
