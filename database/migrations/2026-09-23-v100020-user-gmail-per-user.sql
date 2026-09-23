-- ServiceOS 1.0.0.20: Gmail credentials are owned by the authenticated employee, not by a point.
-- Additive migration. Legacy point_email_senders remains intact for rollback/forensics.

CREATE TABLE IF NOT EXISTS user_gmail_credentials (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  google_sub text,
  sender_email text NOT NULL,
  refresh_token_ciphertext text NOT NULL,
  oauth_client_secret_ciphertext text,
  granted_scopes text[] NOT NULL DEFAULT '{}'::text[],
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED','ERROR')),
  last_error text,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS user_gmail_credentials_google_sub_uq
  ON user_gmail_credentials(google_sub)
  WHERE google_sub IS NOT NULL;

CREATE INDEX IF NOT EXISTS user_gmail_credentials_sender_email_idx
  ON user_gmail_credentials(lower(sender_email));

-- Safe legacy migration only when the stored sender unambiguously belongs to the same ServiceOS user.
INSERT INTO user_gmail_credentials(
  user_id,google_sub,sender_email,refresh_token_ciphertext,oauth_client_secret_ciphertext,
  granted_scopes,status,last_error,connected_at,updated_at
)
SELECT
  pe.connected_by_user_id,
  u.google_sub,
  pe.sender_email,
  pe.refresh_token_ciphertext,
  pe.oauth_client_secret_ciphertext,
  ARRAY['https://www.googleapis.com/auth/gmail.send']::text[],
  pe.status,
  pe.last_error,
  pe.connected_at,
  pe.updated_at
FROM point_email_senders pe
JOIN users u ON u.id=pe.connected_by_user_id
WHERE pe.refresh_token_ciphertext IS NOT NULL
  AND lower(pe.sender_email)=lower(u.email)
  AND (pe.google_sub IS NULL OR u.google_sub IS NULL OR pe.google_sub=u.google_sub)
ON CONFLICT(user_id) DO NOTHING;

INSERT INTO schema_migrations(version,description)
VALUES ('2026-09-23-v100020-user-gmail-per-user','Bind Gmail OAuth credentials and service email sender to the authenticated employee')
ON CONFLICT(version) DO NOTHING;
