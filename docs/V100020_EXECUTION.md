# ServiceOS 1.0.0.20 — execution source of truth

Use this file before doing a broad repository audit on branch `fix/user-frontdesk-flow-1.0.0.20` / PR #97.

## Hard release rules

- Never publish or merge 1.0.0.20 before all verification and smoke gates are green.
- Never change `RELEASE_READY`, `RELEASE_VERSION`, `BUILD_VERSION` or `package.json` release version until the final release stage.
- Develop and validate on TEMP first. PROD only after the exact candidate is green on TEMP.
- Keep migrations additive/backwards-compatible.
- Do not restore cross-user Gmail fallback. Customer/service mail must use the employee stored in `notification_outbox.user_id`.
- OWNER private Gmail is not an operational service sender. Its only allowed exception is the isolated internal meeting invitation sender.

## Environment map

- PROD Neon branch: `br-steep-bonus-b1f1qh8u`
- PROD function: `lockonapi`
- TEMP Neon branch: `br-spring-pond-b1hqe48m`
- TEMP smoke workflow: `.github/workflows/temp-neon-smoke.yml`
- TEMP workflow already matches `fix/user-frontdesk-flow-*`.
- Known external blocker: GitHub Actions currently has no usable `NEON_API_KEY` for exact TEMP deployment, and the connected Neon tool has previously rejected branch calls because of a `project_id` contract mismatch. Do not call TEMP green until an exact candidate is actually deployed and smoked.

## Current architecture

### Gmail per employee

- Table: `user_gmail_credentials`.
- Legacy `point_email_senders` remains only for backwards-compatible migration / old data.
- Main Google login requests `gmail.send`.
- Every active non-OWNER employee can auto-bind their own Google Gmail credential.
- Canonical binding uses Google `sub`; e-mail matching is fallback only for legacy users without a stored `google_sub`.
- Service/customer messages use `notification_outbox.user_id` or explicit `senderUserId`.
- No fallback to another employee or another point is allowed.
- UI identity is exposed through auth state and Settings.

### Meetings / trainings

- Business state: `meetings`, `meeting_audience`, `meeting_registrations`, `meeting_attendance`, `meeting_events`, `meeting_participant_controls`.
- Internal invitation mail: isolated `meeting_email_sender` + `meeting_email_outbox`.
- OWNER/BOSS can create meetings. A designated host can manage their meeting.
- Audience: all users, selected points, or selected users.
- Dashboard refreshes meeting state automatically.
- Live media uses LiveKit SFU/TURN through `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`.
- Join tokens are short-lived and scoped to one room.
- Participants join with microphone off and must enable it consciously.
- Host controls: mute, block/allow microphone, remove participant.
- Screen sharing uses Electron `desktopCapturer` and LiveKit screen-share tracks.
- Attendance tracks join/leave and is finalized when a meeting ends.
- Invitation mail events currently cover CREATED, RESCHEDULED and CANCELLED with deduplication by event key.

## Implementation checklist

- [x] A — per-user Gmail credentials and sender selection.
- [x] A — sender identity visible in UI.
- [x] B — meeting schema and API.
- [x] B — OWNER/BOSS meeting creation and audience selection.
- [x] C — Dashboard meeting card, registration and live refresh.
- [x] D — LiveKit audio room, muted-by-default entry, participant list.
- [x] D — Electron screen source picker and screen share.
- [x] E — host moderation.
- [x] F — isolated invitation outbox, create/cancel/reschedule events.
- [ ] G — exact TEMP deployment of the final candidate.
- [ ] G — full TEMP smoke including migrations, Gmail isolation and meeting flows.
- [ ] G — PROD deployment only after TEMP green.
- [ ] G — production smoke + CodeQL + final release gate.
- [ ] G — only then bump/open 1.0.0.20 release markers and publish.

## Fast verification

For a quick code pass:

```bash
npm ci
npm run verify:fast
```

For the authoritative candidate, rely on GitHub Actions:
- Verify LockOn ServiceOS
- Verify Neon API bundle
- Build central API bundle
- CodeQL security scan
- Temp Neon integration smoke

Do not infer TEMP success from static CI. The TEMP smoke must exercise the exact deployed revision.

## High-value regression cases

1. User A and User B log in with different Google accounts; an action by A must never send as B.
2. Revoked Gmail permission must produce a reconnect state, not a fallback sender.
3. OWNER service actions must not expose/use OWNER private Gmail as customer-service sender.
4. Meeting audience restrictions must prevent unrelated users from obtaining a join token.
5. Registered participant joins muted.
6. Host can block microphone and remove a participant.
7. Rescheduling queues a fresh e-mail every time the time changes; cancellation queues one cancellation event.
8. Duplicate registration/invitation operations remain idempotent.
9. Meeting mail outbox must never be used as the sender source for service/customer notification outbox.
