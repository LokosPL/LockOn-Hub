-- ServiceOS 1.0.0.20: persistent server-side meeting moderation overrides.

CREATE TABLE IF NOT EXISTS meeting_participant_permissions (
  meeting_id text NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  can_publish_audio boolean NOT NULL,
  can_share_screen boolean NOT NULL,
  removed_at timestamptz,
  updated_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(meeting_id,user_id)
);

CREATE INDEX IF NOT EXISTS meeting_participant_permissions_removed_idx
  ON meeting_participant_permissions(meeting_id,removed_at)
  WHERE removed_at IS NOT NULL;

INSERT INTO schema_migrations(version,description)
VALUES ('2026-09-23-v100020-meeting-moderation','Persistent server-side audio, screen-share and removal moderation overrides')
ON CONFLICT(version) DO NOTHING;
