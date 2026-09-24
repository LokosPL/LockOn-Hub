-- ServiceOS 1.0.0.22: meeting collaboration and explicit e-mail controls.
-- Additive only: preserves all existing meetings, attendance and LiveKit lifecycle.

ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS email_notifications_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS meeting_chat_messages (
  id text PRIMARY KEY,
  meeting_id text NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  author_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by_user_id text REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS meeting_chat_messages_meeting_created_idx
  ON meeting_chat_messages(meeting_id, created_at ASC);

CREATE TABLE IF NOT EXISTS meeting_hand_raises (
  meeting_id text NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  raised_at timestamptz NOT NULL DEFAULT now(),
  lowered_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (meeting_id, user_id)
);

CREATE INDEX IF NOT EXISTS meeting_hand_raises_active_idx
  ON meeting_hand_raises(meeting_id, raised_at ASC)
  WHERE lowered_at IS NULL OR lowered_at < raised_at;

INSERT INTO schema_migrations(version,description)
VALUES (
  '2026-09-24-v100022-meeting-collaboration',
  'Meeting chat, raise-hand state and explicit e-mail notification preference'
)
ON CONFLICT (version) DO NOTHING;
