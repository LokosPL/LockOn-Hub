-- v1.0.0.0: bind the operator's active point to the authenticated session.
-- Additive and safe: existing sessions receive a deterministic accessible point.

ALTER TABLE auth_sessions
  ADD COLUMN IF NOT EXISTS active_point_id text REFERENCES points(id);

UPDATE auth_sessions s
SET active_point_id = (
  SELECT p.id
  FROM users u
  JOIN points p ON p.active=true
  LEFT JOIN user_point_access a ON a.user_id=u.id AND a.point_id=p.id
  WHERE u.id=s.user_id
    AND (u.role_code IN ('OWNER','BOSS') OR a.user_id IS NOT NULL)
  ORDER BY p.name,p.id
  LIMIT 1
)
WHERE s.active_point_id IS NULL;

CREATE INDEX IF NOT EXISTS auth_sessions_active_point_idx
  ON auth_sessions(active_point_id)
  WHERE active_point_id IS NOT NULL;

INSERT INTO schema_migrations(version,description)
VALUES ('2026-09-20-v1000-session-active-point','Server-bound active point for intake, status changes and service scans')
ON CONFLICT (version) DO NOTHING;
