-- ServiceOS 1.0.0.20: internal employee meetings.
-- Business state lives in Postgres; media transport (LiveKit) is attached later.

CREATE TABLE IF NOT EXISTS meetings (
  id text PRIMARY KEY,
  host_user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 160),
  description text,
  starts_at timestamptz NOT NULL,
  expected_duration_minutes integer NOT NULL DEFAULT 60 CHECK (expected_duration_minutes BETWEEN 5 AND 720),
  status text NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED','LIVE','ENDED','CANCELLED')),
  audience_type text NOT NULL DEFAULT 'ALL' CHECK (audience_type IN ('ALL','POINTS','USERS')),
  allow_participant_audio boolean NOT NULL DEFAULT true,
  allow_participant_screen_share boolean NOT NULL DEFAULT false,
  max_participants integer NOT NULL DEFAULT 50 CHECK (max_participants BETWEEN 2 AND 500),
  livekit_room_name text NOT NULL UNIQUE,
  started_at timestamptz,
  ended_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meetings_schedule_idx
  ON meetings(status,starts_at,created_at DESC);

CREATE TABLE IF NOT EXISTS meeting_audience_points (
  meeting_id text NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  point_id text NOT NULL REFERENCES points(id) ON DELETE CASCADE,
  PRIMARY KEY(meeting_id,point_id)
);

CREATE TABLE IF NOT EXISTS meeting_audience_users (
  meeting_id text NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY(meeting_id,user_id)
);

CREATE TABLE IF NOT EXISTS meeting_registrations (
  meeting_id text NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'REGISTERED' CHECK (status IN ('REGISTERED','CANCELLED')),
  registered_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(meeting_id,user_id)
);

CREATE INDEX IF NOT EXISTS meeting_registrations_status_idx
  ON meeting_registrations(meeting_id,status,registered_at);

CREATE TABLE IF NOT EXISTS meeting_attendance (
  meeting_id text NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  join_count integer NOT NULL DEFAULT 0 CHECK (join_count >= 0),
  first_joined_at timestamptz,
  last_joined_at timestamptz,
  last_left_at timestamptz,
  current_session_started_at timestamptz,
  total_seconds bigint NOT NULL DEFAULT 0 CHECK (total_seconds >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(meeting_id,user_id)
);

CREATE TABLE IF NOT EXISTS meeting_events (
  id text PRIMARY KEY,
  meeting_id text NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  actor_user_id text REFERENCES users(id) ON DELETE SET NULL,
  target_user_id text REFERENCES users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meeting_events_meeting_idx
  ON meeting_events(meeting_id,created_at DESC);

INSERT INTO schema_migrations(version,description)
VALUES ('2026-09-23-v100020-meetings','Internal employee meetings, audience, registrations, attendance and audit events')
ON CONFLICT(version) DO NOTHING;
