-- v0.20.0: dodatkowe uprawnienie Wsparcie LockOn + jawny stan rozmowy konsultanta
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS support_enabled boolean NOT NULL DEFAULT false;

UPDATE users
SET support_enabled=true
WHERE role_code='SUPPORT' AND support_enabled=false;

ALTER TABLE support_conversations
  ADD COLUMN IF NOT EXISTS consultant_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS consultant_joined_at timestamptz;

ALTER TABLE support_messages
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_support_conversations_consultant_waiting
  ON support_conversations(consultant_requested_at,updated_at DESC)
  WHERE consultant_requested_at IS NOT NULL AND status='OPEN';
