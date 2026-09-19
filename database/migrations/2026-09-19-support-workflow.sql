-- Priority 4: point-scoped consultant workflow
ALTER TABLE support_conversations ADD COLUMN IF NOT EXISTS point_id text REFERENCES points(id) ON DELETE SET NULL;
ALTER TABLE support_conversations ADD COLUMN IF NOT EXISTS assigned_support_user_id text REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE support_conversations ADD COLUMN IF NOT EXISTS taken_at timestamptz;
ALTER TABLE support_conversations ADD COLUMN IF NOT EXISTS closed_at timestamptz;
CREATE INDEX IF NOT EXISTS support_conversations_point_status_idx ON support_conversations(point_id,status,updated_at DESC);
UPDATE support_conversations sc
SET point_id=(SELECT a.point_id FROM user_point_access a WHERE a.user_id=sc.user_id ORDER BY a.point_id LIMIT 1)
WHERE sc.point_id IS NULL;
