-- Customer portal accounts: optional Google identity, notification preferences and staff controls.
CREATE TABLE IF NOT EXISTS customer_portal_accounts (
  customer_id text PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  google_sub text UNIQUE,
  google_email text,
  google_name text,
  google_picture_url text,
  linked_at timestamptz,
  last_login_at timestamptz,
  blocked_at timestamptz,
  blocked_reason text,
  blocked_by_user_id text REFERENCES users(id),
  notify_service_updates boolean NOT NULL DEFAULT true,
  notify_ready_for_pickup boolean NOT NULL DEFAULT true,
  notify_quote_updates boolean NOT NULL DEFAULT true,
  notify_messages boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS customer_portal_accounts_google_sub_uq
  ON customer_portal_accounts(google_sub)
  WHERE google_sub IS NOT NULL;

ALTER TABLE customer_portal_sessions
  ADD COLUMN IF NOT EXISTS auth_method text NOT NULL DEFAULT 'CODE';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='customer_portal_sessions_auth_method_check'
  ) THEN
    ALTER TABLE customer_portal_sessions
      ADD CONSTRAINT customer_portal_sessions_auth_method_check
      CHECK (auth_method IN ('CODE','GOOGLE'));
  END IF;
END $$;

INSERT INTO schema_migrations(version,description)
VALUES (
  '2026-09-20-customer-accounts-google',
  'Customer Google accounts, notification preferences, blocking and session auth mode'
)
ON CONFLICT (version) DO NOTHING;
