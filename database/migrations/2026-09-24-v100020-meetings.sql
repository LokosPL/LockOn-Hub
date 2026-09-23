-- ServiceOS 1.0.0.20: meetings / trainings / webinars.
-- Additive only. Media transport is intentionally separate from this business state.

CREATE TABLE IF NOT EXISTS meetings (
  id text PRIMARY KEY,
  created_by_user_id text NOT NULL REFERENCES users(id),
  host_user_id text NOT NULL REFERENCES users(id),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 3 AND 120),
  description text,
  starts_at timestamptz NOT NULL,
  planned_minutes integer NOT NULL DEFAULT 60 CHECK (planned_minutes BETWEEN 10 AND 480),
  status text NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED','LIVE','ENDED','CANCELLED')),
  max_participants integer NOT NULL DEFAULT 50 CHECK (max_participants BETWEEN 2 AND 500),
  allow_participant_audio boolean NOT NULL DEFAULT true,
  allow_participant_screen_share boolean NOT NULL DEFAULT false,
  started_at timestamptz,
  ended_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meetings_status_start_idx ON meetings(status,starts_at);

CREATE TABLE IF NOT EXISTS meeting_audience (
  id text PRIMARY KEY,
  meeting_id text NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  audience_type text NOT NULL CHECK (audience_type IN ('ALL','POINT','USER')),
  point_id text REFERENCES points(id) ON DELETE CASCADE,
  user_id text REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (audience_type='ALL' AND point_id IS NULL AND user_id IS NULL) OR
    (audience_type='POINT' AND point_id IS NOT NULL AND user_id IS NULL) OR
    (audience_type='USER' AND user_id IS NOT NULL AND point_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS meeting_audience_meeting_idx ON meeting_audience(meeting_id);
CREATE UNIQUE INDEX IF NOT EXISTS meeting_audience_all_uq ON meeting_audience(meeting_id) WHERE audience_type='ALL';
CREATE UNIQUE INDEX IF NOT EXISTS meeting_audience_point_uq ON meeting_audience(meeting_id,point_id) WHERE audience_type='POINT';
CREATE UNIQUE INDEX IF NOT EXISTS meeting_audience_user_uq ON meeting_audience(meeting_id,user_id) WHERE audience_type='USER';

CREATE TABLE IF NOT EXISTS meeting_registrations (
  meeting_id text NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'REGISTERED' CHECK (status IN ('REGISTERED','CANCELLED')),
  registered_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(meeting_id,user_id)
);

CREATE INDEX IF NOT EXISTS meeting_registrations_status_idx ON meeting_registrations(meeting_id,status,registered_at);

CREATE TABLE IF NOT EXISTS meeting_attendance (
  meeting_id text NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  first_joined_at timestamptz,
  last_joined_at timestamptz,
  last_left_at timestamptz,
  total_seconds integer NOT NULL DEFAULT 0 CHECK (total_seconds >= 0),
  join_count integer NOT NULL DEFAULT 0 CHECK (join_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(meeting_id,user_id)
);

CREATE TABLE IF NOT EXISTS meeting_events (
  id text PRIMARY KEY,
  meeting_id text NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  actor_user_id text REFERENCES users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS meeting_events_meeting_idx ON meeting_events(meeting_id,created_at DESC);

CREATE TABLE IF NOT EXISTS meeting_email_sender (
  id text PRIMARY KEY CHECK (id='default'),
  connected_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
  sender_email text NOT NULL,
  refresh_token_ciphertext text NOT NULL,
  oauth_client_secret_ciphertext text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED','ERROR')),
  last_error text,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Preserve a known OWNER/admin Gmail only for internal meeting invitations.
-- This legacy credential is never used again for customer service messages.
INSERT INTO meeting_email_sender(
  id,connected_by_user_id,sender_email,refresh_token_ciphertext,
  oauth_client_secret_ciphertext,status,last_error,connected_at,updated_at
)
SELECT
  'default',pe.connected_by_user_id,pe.sender_email,pe.refresh_token_ciphertext,
  pe.oauth_client_secret_ciphertext,pe.status,pe.last_error,pe.connected_at,pe.updated_at
FROM point_email_senders pe
JOIN users u ON u.id=pe.connected_by_user_id
WHERE u.role_code='OWNER' AND pe.refresh_token_ciphertext IS NOT NULL
ORDER BY pe.updated_at DESC
LIMIT 1
ON CONFLICT(id) DO NOTHING;

CREATE TABLE IF NOT EXISTS meeting_email_outbox (
  id text PRIMARY KEY,
  meeting_id text NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  recipient_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_email text NOT NULL,
  event_key text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSING','SENT','FAILED','CANCELLED')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(meeting_id,recipient_user_id,event_key)
);

INSERT INTO schema_migrations(version,description)
VALUES ('2026-09-24-v100020-meetings','Meetings scheduling, audience, registrations, attendance and isolated invitation outbox')
ON CONFLICT (version) DO NOTHING;
