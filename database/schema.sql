-- LockOn ServiceOS central schema (Neon / PostgreSQL)
-- Mirrors the schema already provisioned in Neon project "LockOn ServiceOS".
-- Keep this file additive/backwards-compatible; destructive migrations require review.

CREATE TABLE IF NOT EXISTS roles (
  code text PRIMARY KEY,
  label text NOT NULL,
  global_scope boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  google_sub text UNIQUE,
  email text NOT NULL,
  name text NOT NULL,
  picture_url text,
  role_code text REFERENCES roles(code),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACTIVE','REJECTED')),
  first_login_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uq ON users (lower(email));

CREATE TABLE IF NOT EXISTS points (
  id text PRIMARY KEY,
  name text NOT NULL,
  city text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_point_access (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  point_id text NOT NULL REFERENCES points(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, point_id)
);

CREATE TABLE IF NOT EXISTS access_requests (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  point_name text NOT NULL,
  city text NOT NULL,
  requested_role_code text NOT NULL REFERENCES roles(code),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by_user_id text REFERENCES users(id),
  note text
);

CREATE TABLE IF NOT EXISTS customers (
  id text PRIMARY KEY,
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text,
  phone text,
  phone_normalized text,
  created_by_user_id text REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customers_email_lower_idx ON customers (lower(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS customers_phone_normalized_idx ON customers (phone_normalized) WHERE phone_normalized IS NOT NULL;
CREATE INDEX IF NOT EXISTS customers_name_idx ON customers (lower(last_name), lower(first_name));

CREATE TABLE IF NOT EXISTS devices (
  id text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  brand text NOT NULL,
  model text NOT NULL,
  imei text,
  serial_number text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS service_orders (
  id text PRIMARY KEY,
  order_number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  point_id text NOT NULL REFERENCES points(id),
  customer_id text NOT NULL REFERENCES customers(id),
  device_id text NOT NULL REFERENCES devices(id),
  order_type text NOT NULL CHECK (order_type IN ('REPAIR','COMPLAINT','WARRANTY')),
  original_order_id text REFERENCES service_orders(id),
  issue_description text NOT NULL,
  status text NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED','DIAGNOSIS','WAITING_PARTS','IN_REPAIR','READY','COMPLETED','CANCELLED','REJECTED')),
  assigned_technician_id text REFERENCES users(id),
  created_by_user_id text NOT NULL REFERENCES users(id),
  estimated_cost numeric(12,2),
  final_cost numeric(12,2),
  currency char(3) NOT NULL DEFAULT 'PLN',
  received_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS service_orders_point_status_idx ON service_orders (point_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS service_orders_customer_idx ON service_orders (customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS service_order_status_history (
  id text PRIMARY KEY,
  service_order_id text NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  note text,
  changed_by_user_id text REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS revenue_entries (
  id text PRIMARY KEY,
  point_id text NOT NULL REFERENCES points(id),
  user_id text NOT NULL REFERENCES users(id),
  service_order_id text REFERENCES service_orders(id),
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  currency char(3) NOT NULL DEFAULT 'PLN',
  category text NOT NULL DEFAULT 'SERVICE',
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','SETTLED')),
  note text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  approved_by_user_id text REFERENCES users(id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settlements (
  id text PRIMARY KEY,
  point_id text REFERENCES points(id),
  user_id text REFERENCES users(id),
  period_start date NOT NULL,
  period_end date NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  currency char(3) NOT NULL DEFAULT 'PLN',
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED','PAID')),
  created_by_user_id text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

CREATE TABLE IF NOT EXISTS support_conversations (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject text,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS support_messages (
  id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
  sender_user_id text REFERENCES users(id),
  sender_kind text NOT NULL CHECK (sender_kind IN ('USER','SUPPORT','SYSTEM','ASSISTANT')),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id text PRIMARY KEY,
  actor_user_id text REFERENCES users(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  point_id text REFERENCES points(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  client_type text NOT NULL DEFAULT 'DESKTOP' CHECK (client_type IN ('DESKTOP','WEB')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS website_auth_codes (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_from_session_id text REFERENCES auth_sessions(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS notification_outbox (
  id text PRIMARY KEY,
  user_id text REFERENCES users(id),
  customer_id text REFERENCES customers(id),
  service_order_id text REFERENCES service_orders(id),
  channel text NOT NULL CHECK (channel IN ('EMAIL')),
  template_key text NOT NULL,
  recipient text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSING','SENT','FAILED','CANCELLED')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO roles(code,label,global_scope) VALUES
 ('OWNER','Właściciel',true),
 ('BOSS','Szef',true),
 ('COORDINATOR','Koordynator',false),
 ('SUPPORT','Wsparcie',false),
 ('TECHNICIAN','Technik',false),
 ('USER','Użytkownik',false)
ON CONFLICT (code) DO UPDATE SET label=EXCLUDED.label, global_scope=EXCLUDED.global_scope;

INSERT INTO points(id,name,city,active) VALUES ('nowogard','Punkt Nowogard','Nowogard',true)
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, city=EXCLUDED.city, active=EXCLUDED.active, updated_at=now();

INSERT INTO users(id,email,name,role_code,status,first_login_at,last_login_at)
VALUES ('usr_owner','nowogar@gmail.com','Bartłomiej Motłoch','OWNER','ACTIVE',now(),now())
ON CONFLICT (id) DO UPDATE SET email=EXCLUDED.email,name=EXCLUDED.name,role_code='OWNER',status='ACTIVE',updated_at=now();
