-- ServiceOS 1.0.0.20: separate employee meeting invitation e-mail outbox.
-- Intentionally independent from customer notification_outbox.

CREATE TABLE IF NOT EXISTS meeting_email_outbox (
  id text PRIMARY KEY,
  meeting_id text NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  sender_user_id text REFERENCES users(id) ON DELETE SET NULL,
  recipient_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('INVITE','CANCELLED','UPDATED')),
  dedupe_key text NOT NULL UNIQUE,
  recipient text NOT NULL,
  subject text,
  body_text text,
  body_html text,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSING','SENT','FAILED','CANCELLED')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  provider_message_id text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meeting_email_outbox_retry_idx
  ON meeting_email_outbox(status,available_at,attempts)
  WHERE status IN ('PENDING','FAILED');

CREATE INDEX IF NOT EXISTS meeting_email_outbox_meeting_idx
  ON meeting_email_outbox(meeting_id,created_at DESC);

INSERT INTO schema_migrations(version,description)
VALUES ('2026-09-23-v100020-meeting-invites','Separate deduplicated employee meeting invitation e-mail outbox')
ON CONFLICT(version) DO NOTHING;
