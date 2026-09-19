-- Customer portal, history and remote quote workflow.
-- Additive migration. Test on Neon branch before production.

ALTER TABLE customers ADD COLUMN IF NOT EXISTS portal_code_hash text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS portal_code_ciphertext text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS portal_code_created_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS customers_portal_code_hash_uq
  ON customers(portal_code_hash)
  WHERE portal_code_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS customer_portal_sessions (
  id text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS customer_portal_sessions_customer_idx
  ON customer_portal_sessions(customer_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS customer_portal_sessions_expiry_idx
  ON customer_portal_sessions(expires_at);

CREATE TABLE IF NOT EXISTS customer_quote_requests (
  id text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  requested_point_id text NOT NULL REFERENCES points(id),
  routed_point_id text NOT NULL REFERENCES points(id),
  assigned_technician_id text REFERENCES users(id) ON DELETE SET NULL,
  service_order_id text REFERENCES service_orders(id) ON DELETE SET NULL,
  device_description text NOT NULL,
  issue_description text NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','QUOTED','CLOSED','CANCELLED')),
  quote_amount numeric(12,2) CHECK (quote_amount IS NULL OR quote_amount >= 0),
  currency char(3) NOT NULL DEFAULT 'PLN',
  quote_note text,
  routing_reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  quoted_at timestamptz,
  closed_at timestamptz
);

CREATE INDEX IF NOT EXISTS customer_quote_requests_customer_idx
  ON customer_quote_requests(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS customer_quote_requests_routed_idx
  ON customer_quote_requests(routed_point_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS customer_quote_requests_assignee_idx
  ON customer_quote_requests(assigned_technician_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS customer_quote_messages (
  id text PRIMARY KEY,
  request_id text NOT NULL REFERENCES customer_quote_requests(id) ON DELETE CASCADE,
  sender_kind text NOT NULL CHECK (sender_kind IN ('CUSTOMER','STAFF','SYSTEM')),
  sender_user_id text REFERENCES users(id) ON DELETE SET NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customer_quote_messages_request_idx
  ON customer_quote_messages(request_id, created_at ASC);
