-- LockOn ServiceOS central schema (Neon / PostgreSQL)
-- Mirrors the schema already provisioned in Neon project "LockOn ServiceOS".
-- Keep this file additive/backwards-compatible; destructive migrations require review.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  description text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations(version,description)
VALUES ('2026-09-18-central-v1','Initial LockOn ServiceOS central schema')
ON CONFLICT (version) DO NOTHING;

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
  technician_split_percent numeric(5,2) CHECK (technician_split_percent IS NULL OR (technician_split_percent >= 0 AND technician_split_percent <= 100)),
  support_enabled boolean NOT NULL DEFAULT false,
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
  service_enabled boolean NOT NULL DEFAULT false,
  accepts_external_repairs boolean NOT NULL DEFAULT false,
  external_repairs_paused boolean NOT NULL DEFAULT false,
  service_note text,
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
  technician_split_percent numeric(5,2) CHECK (technician_split_percent IS NULL OR (technician_split_percent >= 0 AND technician_split_percent <= 100)),
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
  portal_code_hash text,
  portal_code_ciphertext text,
  portal_code_created_at timestamptz,
  created_by_user_id text REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customers_email_lower_idx ON customers (lower(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS customers_phone_normalized_idx ON customers (phone_normalized) WHERE phone_normalized IS NOT NULL;
CREATE INDEX IF NOT EXISTS customers_name_idx ON customers (lower(last_name), lower(first_name));
CREATE UNIQUE INDEX IF NOT EXISTS customers_portal_code_hash_uq ON customers(portal_code_hash) WHERE portal_code_hash IS NOT NULL;

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
  home_point_id text NOT NULL REFERENCES points(id),
  current_point_id text REFERENCES points(id),
  customer_id text NOT NULL REFERENCES customers(id),
  device_id text NOT NULL REFERENCES devices(id),
  order_type text NOT NULL CHECK (order_type IN ('REPAIR','COMPLAINT','WARRANTY')),
  handling_mode text NOT NULL DEFAULT 'STANDARD' CHECK (handling_mode IN ('STANDARD','TRANSFER_ONLY')),
  tracking_token_hash text,
  tracking_token_ciphertext text,
  tracking_created_at timestamptz,
  original_order_id text REFERENCES service_orders(id),
  issue_description text NOT NULL,
  status text NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED','DIAGNOSIS','WAITING_PARTS','IN_REPAIR','REPAIR_DONE','READY','COMPLETED','CANCELLED','REJECTED')),
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
  technician_percent numeric(5,2) NOT NULL DEFAULT 50 CHECK (technician_percent >= 0 AND technician_percent <= 100),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','SETTLED')),
  note text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  approved_by_user_id text REFERENCES users(id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS revenue_entries_service_order_unique_idx
  ON revenue_entries(service_order_id)
  WHERE service_order_id IS NOT NULL;

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
  point_id text REFERENCES points(id) ON DELETE SET NULL,
  assigned_support_user_id text REFERENCES users(id) ON DELETE SET NULL,
  subject text,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  taken_at timestamptz,
  consultant_requested_at timestamptz,
  consultant_joined_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_conversations_point_status_idx ON support_conversations(point_id,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_conversations_consultant_waiting ON support_conversations(consultant_requested_at,updated_at DESC) WHERE consultant_requested_at IS NOT NULL AND status='OPEN';

CREATE TABLE IF NOT EXISTS support_messages (
  id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
  sender_user_id text REFERENCES users(id),
  sender_kind text NOT NULL CHECK (sender_kind IN ('USER','SUPPORT','SYSTEM','ASSISTANT')),
  body text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customer_portal_sessions (
  id text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS customer_portal_sessions_customer_idx ON customer_portal_sessions(customer_id,expires_at DESC);
CREATE INDEX IF NOT EXISTS customer_portal_sessions_expiry_idx ON customer_portal_sessions(expires_at);


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

DO $
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='customer_portal_sessions_auth_method_check'
  ) THEN
    ALTER TABLE customer_portal_sessions
      ADD CONSTRAINT customer_portal_sessions_auth_method_check
      CHECK (auth_method IN ('CODE','GOOGLE'));
  END IF;
END $;

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
CREATE INDEX IF NOT EXISTS customer_quote_requests_customer_idx ON customer_quote_requests(customer_id,created_at DESC);
CREATE INDEX IF NOT EXISTS customer_quote_requests_routed_idx ON customer_quote_requests(routed_point_id,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS customer_quote_requests_assignee_idx ON customer_quote_requests(assigned_technician_id,status,updated_at DESC);

CREATE TABLE IF NOT EXISTS customer_quote_messages (
  id text PRIMARY KEY,
  request_id text NOT NULL REFERENCES customer_quote_requests(id) ON DELETE CASCADE,
  sender_kind text NOT NULL CHECK (sender_kind IN ('CUSTOMER','STAFF','SYSTEM')),
  sender_user_id text REFERENCES users(id) ON DELETE SET NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_quote_messages_request_idx ON customer_quote_messages(request_id,created_at ASC);

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

CREATE TABLE IF NOT EXISTS system_reset_log (
  id text PRIMARY KEY,
  actor_email text NOT NULL,
  actor_name text,
  client_type text,
  reason text,
  status text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','COMPLETED','FAILED')),
  deleted_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS system_reset_log_created_idx ON system_reset_log(created_at DESC);

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


-- 2026-09-18 central-v2: account-scoped help, Gmail sender and assistant knowledge.
CREATE TABLE IF NOT EXISTS point_email_senders (
  point_id text PRIMARY KEY REFERENCES points(id) ON DELETE CASCADE,
  connected_by_user_id text NOT NULL REFERENCES users(id),
  sender_email text NOT NULL,
  google_sub text,
  refresh_token_ciphertext text NOT NULL,
  oauth_client_secret_ciphertext text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED','ERROR')),
  last_error text,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2026-09-24 ServiceOS 1.0.0.20: OAuth sender belongs to the employee, not to a point.
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
CREATE UNIQUE INDEX IF NOT EXISTS user_gmail_credentials_google_sub_uq ON user_gmail_credentials(google_sub) WHERE google_sub IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS user_gmail_credentials_sender_email_uq ON user_gmail_credentials(lower(sender_email));


CREATE TABLE IF NOT EXISTS assistant_knowledge (
  slug text PRIMARY KEY,
  title text NOT NULL,
  keywords text[] NOT NULL DEFAULT '{}',
  body text NOT NULL,
  audience text NOT NULL DEFAULT 'ALL' CHECK (audience IN ('ALL','OWNER')),
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS support_open_conversation_user_uq
  ON support_conversations(user_id) WHERE status = 'OPEN';

CREATE INDEX IF NOT EXISTS notification_outbox_order_idx
  ON notification_outbox(service_order_id, created_at DESC)
  WHERE service_order_id IS NOT NULL;

INSERT INTO assistant_knowledge(slug,title,keywords,body,audience) VALUES
 ('login','Logowanie Google',ARRAY['login','logowanie','google','oauth','pkce','gmail','zgoda'],'Logowanie desktopowe otwiera systemową przeglądarkę i używa Authorization Code z PKCE oraz state. Hasło Google nie jest wpisywane do ServiceOS. Dla uprawnionego użytkownika z jednym punktem aplikacja może po zalogowaniu od razu sprawdzić konfigurację Gmail i, jeśli trzeba, przeprowadzić jednorazową zgodę na gmail.send.','ALL'),
 ('service','Moduł Serwis',ARRAY['serwis','klient','telefon','urządzenie','urzadzenie','imei','serial','naprawa','zlecenie','reklamacja','technik','termin','notatka','karta klienta'],'Moduł Serwis pozwala wyszukać lub ponownie użyć klienta, dodać urządzenie, utworzyć naprawę albo reklamację i prowadzić zlecenie do zakończenia. Karta zlecenia obsługuje IMEI, numer seryjny, przewidywany termin, przypisanego technika, notatki wewnętrzne i historię statusów. ServiceOS rozpoznaje istniejącego klienta po e-mailu lub znormalizowanym telefonie oraz może ponownie użyć urządzenia po IMEI lub zgodnym numerze seryjnym. Wszystkie wyszukiwania klientów i zleceń są ograniczone do punktów dostępnych dla zalogowanego konta. Dane kosztowe są przeznaczone dla OWNER, BOSS i COORDINATOR.','ALL'),
 ('notifications','Powiadomienia klienta',ARRAY['email','mail','gmail','powiadomienie','status','retry','ponów','ponow','historia','test','przyjęcie','przyjecie','received','gmail.send'],'Powiadomienia serwisowe są konfigurowane osobno dla punktu. Po jednorazowej zgodzie Google ServiceOS używa wyłącznie zakresu gmail.send do wysyłania wiadomości i nie czyta skrzynki Gmail. OWNER, BOSS lub COORDINATOR może połączyć nadawcę, wysłać test, wybrać statusy generujące wiadomość, ustawić nazwę nadawcy i stopkę oraz przeglądać historię dostawy. Nieudane wysyłki mają exponential backoff i mogą być ponawiane automatycznie przez worker Neon lub ręcznie przez uprawnionego użytkownika.','ALL'),
 ('website','Logowanie na stronie',ARRAY['strona','www','kod','autoryzacja'],'Zalogowany użytkownik może wygenerować jednorazowy kod do strony. Kod ma krótki termin ważności, może być użyty tylko raz, a baza przechowuje jego hash.','ALL'),
 ('updates','Aktualizacje',ARRAY['aktualizacja','update','wersja'],'ServiceOS sprawdza GitHub Releases po starcie, cyklicznie podczas pracy i po powrocie do aplikacji. Aktualizacja pobiera się automatycznie, a instalacja następuje po potwierdzeniu użytkownika.','ALL'),
 ('security','Bezpieczeństwo',ARRAY['bezpieczeństwo','security','token','sesja'],'ServiceOS używa sandboxa Electron, contextIsolation, nodeIntegration=false, walidacji IPC, CSP, bezpiecznego magazynu sesji oraz hashy tokenów po stronie backendu.','ALL'),
 ('roles-owner','Role i uprawnienia',ARRAY['role','uprawnienia','owner','boss','coordinator','support','technician','user'],'Pełny katalog ról i uprawnień jest informacją administracyjną widoczną wyłącznie dla OWNER.','OWNER')
ON CONFLICT (slug) DO UPDATE SET
  title=EXCLUDED.title,
  keywords=EXCLUDED.keywords,
  body=EXCLUDED.body,
  audience=EXCLUDED.audience,
  enabled=true,
  updated_at=now();

INSERT INTO schema_migrations(version,description)
VALUES ('2026-09-18-central-v2','Gmail sender, account-scoped help and assistant knowledge')
ON CONFLICT (version) DO NOTHING;


-- 2026-09-18 central-v3: Google token endpoint compatibility for Gmail refresh.
ALTER TABLE point_email_senders
  ADD COLUMN IF NOT EXISTS oauth_client_secret_ciphertext text;

INSERT INTO schema_migrations(version,description)
VALUES ('2026-09-18-central-v3','Store encrypted OAuth client credential for Gmail refresh flow')
ON CONFLICT (version) DO NOTHING;


-- 2026-09-18 central-v4: production-grade notification settings and delivery history.
CREATE TABLE IF NOT EXISTS point_notification_settings (
  point_id text PRIMARY KEY REFERENCES points(id) ON DELETE CASCADE,
  automatic_email_enabled boolean NOT NULL DEFAULT true,
  notify_statuses text[] NOT NULL DEFAULT ARRAY['RECEIVED','DIAGNOSIS','WAITING_PARTS','IN_REPAIR','REPAIR_DONE','READY','COMPLETED','REJECTED','CANCELLED']::text[],
  sender_display_name text NOT NULL DEFAULT 'LockOn ServiceOS',
  footer_text text,
  updated_by_user_id text REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE notification_outbox ADD COLUMN IF NOT EXISTS subject text;
ALTER TABLE notification_outbox ADD COLUMN IF NOT EXISTS body_text text;
ALTER TABLE notification_outbox ADD COLUMN IF NOT EXISTS body_html text;
ALTER TABLE notification_outbox ADD COLUMN IF NOT EXISTS provider_message_id text;
ALTER TABLE notification_outbox ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS notification_outbox_retry_idx
  ON notification_outbox(status, available_at, attempts)
  WHERE status IN ('PENDING','FAILED');

INSERT INTO point_notification_settings(point_id)
SELECT id FROM points
ON CONFLICT (point_id) DO NOTHING;

INSERT INTO schema_migrations(version,description)
VALUES ('2026-09-18-central-v4','Notification settings, email rendering metadata and retry tracking')
ON CONFLICT (version) DO NOTHING;


-- 2026-09-18 central-v5: configurable intake confirmation.
ALTER TABLE point_notification_settings
  ALTER COLUMN notify_statuses
  SET DEFAULT ARRAY['RECEIVED','DIAGNOSIS','WAITING_PARTS','IN_REPAIR','REPAIR_DONE','READY','COMPLETED','REJECTED','CANCELLED']::text[];

UPDATE point_notification_settings
SET notify_statuses = array_prepend('RECEIVED', notify_statuses), updated_at=now()
WHERE NOT ('RECEIVED'=ANY(notify_statuses));

INSERT INTO schema_migrations(version,description)
VALUES ('2026-09-18-central-v5','Send configurable intake confirmation at RECEIVED status')
ON CONFLICT (version) DO NOTHING;


-- 2026-09-18 central-v6: race-safe customer deduplication.
CREATE UNIQUE INDEX IF NOT EXISTS customers_email_unique_idx
  ON customers ((lower(email)))
  WHERE email IS NOT NULL AND btrim(email)<>'';

CREATE UNIQUE INDEX IF NOT EXISTS customers_phone_unique_idx
  ON customers (phone_normalized)
  WHERE phone_normalized IS NOT NULL AND phone_normalized<>'';

INSERT INTO schema_migrations(version,description)
VALUES ('2026-09-18-central-v6','Prevent duplicate customers by normalized email or phone')
ON CONFLICT (version) DO NOTHING;


-- 2026-09-18 central-v7: richer service order workspace.
ALTER TABLE service_orders
  ADD COLUMN IF NOT EXISTS estimated_completion_at timestamptz;

CREATE TABLE IF NOT EXISTS service_order_notes (
  id text PRIMARY KEY,
  service_order_id text NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
  author_user_id text NOT NULL REFERENCES users(id),
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS service_order_notes_order_idx
  ON service_order_notes(service_order_id, created_at DESC);

CREATE INDEX IF NOT EXISTS devices_imei_idx
  ON devices(imei) WHERE imei IS NOT NULL AND btrim(imei)<>'';

CREATE INDEX IF NOT EXISTS devices_serial_idx
  ON devices(serial_number) WHERE serial_number IS NOT NULL AND btrim(serial_number)<>'';

INSERT INTO schema_migrations(version,description)
VALUES ('2026-09-18-central-v7','Service order ETA, internal notes and device lookup indexes')
ON CONFLICT (version) DO NOTHING;


-- 2026-09-18 central-v8: one physical device per non-empty IMEI.
CREATE UNIQUE INDEX IF NOT EXISTS devices_imei_unique_idx
  ON devices(imei)
  WHERE imei IS NOT NULL AND btrim(imei)<>'';

INSERT INTO schema_migrations(version,description)
VALUES ('2026-09-18-central-v8','Enforce unique non-empty device IMEI')
ON CONFLICT (version) DO NOTHING;


-- 2026-09-18 central-v9: refresh assistant knowledge for the richer service workflow.
UPDATE assistant_knowledge
SET keywords=ARRAY['serwis','klient','telefon','urządzenie','urzadzenie','imei','serial','naprawa','zlecenie','reklamacja','technik','termin','notatka','karta klienta'],
    body='Moduł Serwis pozwala wyszukać lub ponownie użyć klienta, dodać urządzenie, utworzyć naprawę albo reklamację i prowadzić zlecenie do zakończenia. Karta zlecenia obsługuje IMEI, numer seryjny, przewidywany termin, przypisanego technika, notatki wewnętrzne i historię statusów. ServiceOS rozpoznaje istniejącego klienta po e-mailu lub znormalizowanym telefonie oraz może ponownie użyć urządzenia po IMEI lub zgodnym numerze seryjnym. Wszystkie wyszukiwania klientów i zleceń są ograniczone do punktów dostępnych dla zalogowanego konta. Dane kosztowe są przeznaczone dla OWNER, BOSS i COORDINATOR.',
    updated_at=now()
WHERE slug='service';

UPDATE assistant_knowledge
SET keywords=ARRAY['email','mail','gmail','powiadomienie','status','retry','ponów','ponow','historia','test','przyjęcie','przyjecie','received','gmail.send'],
    body='Powiadomienia serwisowe są konfigurowane osobno dla punktu. Po jednorazowej zgodzie Google ServiceOS używa wyłącznie zakresu gmail.send do wysyłania wiadomości i nie czyta skrzynki Gmail. OWNER, BOSS lub COORDINATOR może połączyć nadawcę, wysłać test, wybrać statusy generujące wiadomość, ustawić nazwę nadawcy i stopkę oraz przeglądać historię dostawy. Nieudane wysyłki mają exponential backoff i mogą być ponawiane automatycznie przez worker Neon lub ręcznie przez uprawnionego użytkownika.',
    updated_at=now()
WHERE slug='notifications';

UPDATE assistant_knowledge
SET keywords=ARRAY['login','logowanie','google','oauth','pkce','gmail','zgoda'],
    body='Logowanie desktopowe otwiera systemową przeglądarkę i używa Authorization Code z PKCE oraz state. Hasło Google nie jest wpisywane do ServiceOS. Dla uprawnionego użytkownika z jednym punktem aplikacja może po zalogowaniu od razu sprawdzić konfigurację Gmail i, jeśli trzeba, przeprowadzić jednorazową zgodę na gmail.send.',
    updated_at=now()
WHERE slug='login';

INSERT INTO schema_migrations(version,description)
VALUES ('2026-09-18-central-v9','Refresh assistant knowledge for rich service workspace and Gmail onboarding')
ON CONFLICT (version) DO NOTHING;


-- 2026-09-18 central-v10: account blocking and inter-point service logistics.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS blocked_at timestamptz,
  ADD COLUMN IF NOT EXISTS blocked_reason text,
  ADD COLUMN IF NOT EXISTS blocked_by_user_id text REFERENCES users(id);

ALTER TABLE points
  ADD COLUMN IF NOT EXISTS service_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS accepts_external_repairs boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS service_note text;

UPDATE points
SET service_enabled=true, accepts_external_repairs=true
WHERE id='nowogard';

CREATE TABLE IF NOT EXISTS service_order_transfers (
  id text PRIMARY KEY,
  service_order_id text NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
  from_point_id text NOT NULL REFERENCES points(id),
  to_point_id text NOT NULL REFERENCES points(id),
  kind text NOT NULL DEFAULT 'OUTBOUND_SERVICE' CHECK (kind IN ('OUTBOUND_SERVICE','RETURN_HOME')),
  status text NOT NULL DEFAULT 'REQUESTED'
    CHECK (status IN ('REQUESTED','IN_TRANSIT','DELIVERED','ACCEPTED','REJECTED','CANCELLED')),
  note text,
  sent_by_user_id text NOT NULL REFERENCES users(id),
  accepted_by_user_id text REFERENCES users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  shipped_at timestamptz,
  delivered_at timestamptz,
  accepted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_point_id <> to_point_id)
);

CREATE INDEX IF NOT EXISTS service_order_transfers_order_idx
  ON service_order_transfers(service_order_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS service_order_transfers_destination_idx
  ON service_order_transfers(to_point_id, status, requested_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS service_order_transfers_one_open_idx
  ON service_order_transfers(service_order_id)
  WHERE status IN ('REQUESTED','IN_TRANSIT','DELIVERED');

INSERT INTO schema_migrations(version,description)
VALUES ('2026-09-18-central-v10','Account blocking, service-capable points and inter-point service transfers')
ON CONFLICT (version) DO NOTHING;


-- 2026-09-18 central-v11: permanent home point and mandatory return logistics.
ALTER TABLE service_orders
  ADD COLUMN IF NOT EXISTS home_point_id text REFERENCES points(id),
  ADD COLUMN IF NOT EXISTS current_point_id text REFERENCES points(id);

UPDATE service_orders
SET home_point_id=point_id
WHERE home_point_id IS NULL;

ALTER TABLE service_order_transfers
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'OUTBOUND_SERVICE';

UPDATE service_order_transfers t
SET kind=CASE
  WHEN t.to_point_id=COALESCE(s.home_point_id,s.point_id)
       AND t.from_point_id<>COALESCE(s.home_point_id,s.point_id)
    THEN 'RETURN_HOME'
  ELSE 'OUTBOUND_SERVICE'
END
FROM service_orders s
WHERE s.id=t.service_order_id;

ALTER TABLE service_order_transfers
  DROP CONSTRAINT IF EXISTS service_order_transfers_kind_check;

ALTER TABLE service_order_transfers
  ADD CONSTRAINT service_order_transfers_kind_check
  CHECK (kind IN ('OUTBOUND_SERVICE','RETURN_HOME'));

UPDATE service_orders s
SET current_point_id=CASE
  WHEN EXISTS (
    SELECT 1 FROM service_order_transfers t
    WHERE t.service_order_id=s.id
  ) THEN (
    SELECT CASE
      WHEN t.status='IN_TRANSIT' THEN NULL
      WHEN t.status IN ('REQUESTED','CANCELLED') THEN t.from_point_id
      ELSE t.to_point_id
    END
    FROM service_order_transfers t
    WHERE t.service_order_id=s.id
    ORDER BY t.requested_at DESC
    LIMIT 1
  )
  ELSE s.home_point_id
END
WHERE current_point_id IS NULL;

ALTER TABLE service_orders
  DROP CONSTRAINT IF EXISTS service_orders_status_check;

ALTER TABLE service_orders
  ADD CONSTRAINT service_orders_status_check
  CHECK (status IN ('RECEIVED','DIAGNOSIS','WAITING_PARTS','IN_REPAIR','REPAIR_DONE','READY','COMPLETED','CANCELLED','REJECTED'));

CREATE INDEX IF NOT EXISTS service_orders_home_status_idx
  ON service_orders(home_point_id,status,created_at DESC);

CREATE INDEX IF NOT EXISTS service_orders_current_point_idx
  ON service_orders(current_point_id,updated_at DESC)
  WHERE current_point_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS service_order_transfers_kind_idx
  ON service_order_transfers(service_order_id,kind,requested_at DESC);

INSERT INTO schema_migrations(version,description)
VALUES ('2026-09-18-central-v11','Permanent home point, current physical location, return-home transfer kind and repair-done status')
ON CONFLICT (version) DO NOTHING;

-- 2026-09-19 central-v12: technician-driven service availability and persistent factory-reset audit.
ALTER TABLE points
  ADD COLUMN IF NOT EXISTS external_repairs_paused boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS system_reset_log (
  id text PRIMARY KEY,
  actor_email text NOT NULL,
  actor_name text,
  client_type text,
  reason text,
  deleted_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS system_reset_log_created_idx
  ON system_reset_log(created_at DESC);

INSERT INTO schema_migrations(version,description)
VALUES ('2026-09-19-central-v12','Technician-driven service availability and persistent factory-reset audit')
ON CONFLICT (version) DO NOTHING;

-- 2026-09-19 central-v13: reliable status mail fallback and automatic service settlement.
ALTER TABLE point_notification_settings
  ALTER COLUMN notify_statuses
  SET DEFAULT ARRAY['RECEIVED','DIAGNOSIS','WAITING_PARTS','IN_REPAIR','REPAIR_DONE','READY','COMPLETED','REJECTED','CANCELLED']::text[];

UPDATE point_notification_settings
SET notify_statuses = array_append(notify_statuses,'REPAIR_DONE'),
    updated_at = now()
WHERE NOT ('REPAIR_DONE'=ANY(notify_statuses));

UPDATE point_notification_settings
SET notify_statuses = array_append(notify_statuses,'CANCELLED'),
    updated_at = now()
WHERE NOT ('CANCELLED'=ANY(notify_statuses));

CREATE UNIQUE INDEX IF NOT EXISTS revenue_entries_service_order_unique_idx
  ON revenue_entries(service_order_id)
  WHERE service_order_id IS NOT NULL;

INSERT INTO revenue_entries(
  id,point_id,user_id,service_order_id,amount,currency,category,status,note,
  occurred_at,approved_by_user_id,approved_at
)
SELECT
  'rev_auto_' || substr(md5(s.id),1,20),
  coalesce(s.home_point_id,s.point_id),
  coalesce(s.assigned_technician_id,s.created_by_user_id),
  s.id,
  coalesce(s.final_cost,s.estimated_cost),
  s.currency,
  'SERVICE',
  'APPROVED',
  'Automatyczne rozliczenie zakończonego zlecenia #' || s.order_number,
  coalesce(s.completed_at,s.updated_at,now()),
  s.created_by_user_id,
  coalesce(s.completed_at,s.updated_at,now())
FROM service_orders s
WHERE s.status='COMPLETED'
  AND coalesce(s.final_cost,s.estimated_cost) > 0
  AND NOT EXISTS (
    SELECT 1 FROM revenue_entries r WHERE r.service_order_id=s.id
  )
ON CONFLICT DO NOTHING;

INSERT INTO schema_migrations(version,description)
VALUES ('2026-09-19-central-v13','Reliable status mail fallback and automatic approved service settlement')
ON CONFLICT (version) DO NOTHING;

-- 2026-09-19 central-v14: technician-defined settlement share with per-entry snapshots.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS technician_split_percent numeric(5,2);

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_technician_split_percent_check;
ALTER TABLE users
  ADD CONSTRAINT users_technician_split_percent_check
  CHECK (technician_split_percent IS NULL OR (technician_split_percent >= 0 AND technician_split_percent <= 100));

ALTER TABLE access_requests
  ADD COLUMN IF NOT EXISTS technician_split_percent numeric(5,2);

ALTER TABLE access_requests
  DROP CONSTRAINT IF EXISTS access_requests_technician_split_percent_check;
ALTER TABLE access_requests
  ADD CONSTRAINT access_requests_technician_split_percent_check
  CHECK (technician_split_percent IS NULL OR (technician_split_percent >= 0 AND technician_split_percent <= 100));

ALTER TABLE revenue_entries
  ADD COLUMN IF NOT EXISTS technician_percent numeric(5,2);

UPDATE revenue_entries
SET technician_percent=50
WHERE technician_percent IS NULL;

ALTER TABLE revenue_entries
  ALTER COLUMN technician_percent SET DEFAULT 50,
  ALTER COLUMN technician_percent SET NOT NULL;

ALTER TABLE revenue_entries
  DROP CONSTRAINT IF EXISTS revenue_entries_technician_percent_check;
ALTER TABLE revenue_entries
  ADD CONSTRAINT revenue_entries_technician_percent_check
  CHECK (technician_percent >= 0 AND technician_percent <= 100);

INSERT INTO schema_migrations(version,description)
VALUES ('2026-09-19-central-v14','Technician-defined settlement share stored on users, access requests and revenue snapshots')
ON CONFLICT (version) DO NOTHING;

-- 2026-09-19 central-v15: public customer tracking and transfer-only service records.
ALTER TABLE service_orders
  ADD COLUMN IF NOT EXISTS handling_mode text NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN IF NOT EXISTS tracking_token_hash text,
  ADD COLUMN IF NOT EXISTS tracking_token_ciphertext text,
  ADD COLUMN IF NOT EXISTS tracking_created_at timestamptz;

ALTER TABLE service_orders
  DROP CONSTRAINT IF EXISTS service_orders_handling_mode_check;
ALTER TABLE service_orders
  ADD CONSTRAINT service_orders_handling_mode_check
  CHECK (handling_mode IN ('STANDARD','TRANSFER_ONLY'));

CREATE UNIQUE INDEX IF NOT EXISTS service_orders_tracking_token_hash_uq
  ON service_orders(tracking_token_hash)
  WHERE tracking_token_hash IS NOT NULL;

INSERT INTO schema_migrations(version,description)
VALUES ('2026-09-19-central-v15','Secure public service tracking and transfer-only service handling mode')
ON CONFLICT (version) DO NOTHING;



-- v0.20.0 assistant knowledge is maintained by database/migrations/2026-09-19-v020-assistant-knowledge.sql.
-- Keep fresh installs aligned with that migration.
INSERT INTO assistant_knowledge(slug,title,keywords,body,audience) VALUES
('service-intake-v020','Przyjęcie urządzenia',ARRAY['przyjęcie','przyjecie','protokół','protokol','akcesoria','stan urządzenia','stan urzadzenia','backup','blokada ekranu','hasło telefonu','haslo telefonu'],'Przy przyjęciu urządzenia zapisz co najmniej kontakt do klienta, markę i model, opis problemu oraz — jeśli jest dostępny — IMEI lub numer seryjny. Warto dopisać widoczny stan urządzenia i przekazane akcesoria. Nie zapisuj haseł klienta w zwykłych notatkach. Jeżeli diagnostyka wymaga kodu blokady, zastosuj procedurę punktu, która ogranicza dostęp do minimum i pozwala klientowi usunąć kod po zakończeniu. Przed operacjami mogącymi zmienić dane przypomnij o kopii zapasowej. Termin i koszt zapisuj tylko, gdy są realnie oszacowane.','ALL'),
('service-flow-v020','Przepływ zlecenia',ARRAY['etap','status','received','diagnosis','waiting parts','in repair','repair done','ready','completed','gotowe do odbioru','zakończone'],'Typowy przepływ naprawy w ServiceOS prowadzi od przyjęcia przez diagnozę i naprawę do zakończenia. Status Gotowe do odbioru wymaga wcześniej etapu Naprawa zakończona oraz fizycznego powrotu urządzenia do punktu macierzystego. Podczas aktywnego transportu normalna zmiana statusu naprawy jest zablokowana. Pracownik podstawowy może przyjąć, edytować dane przyjęcia, anulować i przekazać urządzenie, ale nie zmienia zwykłych statusów naprawy.','ALL'),
('transfers-v020','Przekazania i lokalizacja',ARRAY['przekazanie','transport','w drodze','lokalizacja','punkt macierzysty','punkt prowadzący','powrót','powrot','fizycznie'],'Przekazanie w ServiceOS opisuje fizyczny ruch urządzenia między punktami. Karta zlecenia rozróżnia punkt macierzysty, aktualną lokalizację i trwający transport. Podczas transportu status naprawy pozostaje zablokowany. Po naprawie wykonanej poza punktem macierzystym urządzenie musi fizycznie wrócić do domu przed oznaczeniem go jako Gotowe do odbioru.','ALL'),
('customer-portal-v020','Portal klienta i kod klienta',ARRAY['kod klienta','identyfikator klienta','portal klienta','historia klienta','śledzenie','sledzenie','track','link klienta'],'Klient ma dwa różne mechanizmy: bezpieczny link śledzenia dotyczy pojedynczego zlecenia, a stały kod klienta otwiera prywatny portal całej historii serwisowej. Stałego kodu nie należy publikować na publicznym linku pojedynczego zlecenia. Kod i adres portalu są wysyłane e-mailem, a po zalogowaniu klient widzi swój kod również w portalu.','ALL'),
('mail-delivery-v020','E-mail i kolejka dostawy',ARRAY['gmail','mail','email','kolejka','retry','ponowienie','provider id','nie wyszło','nie wyszlo','failed','sent'],'ServiceOS nie uznaje wiadomości za wysłaną tylko dlatego, że utworzono zlecenie. Wiadomość trafia do kolejki, a status SENT pojawia się dopiero po zaakceptowaniu jej przez Gmail i zapisaniu identyfikatora wiadomości dostawcy. Przy błędzie status jest FAILED i działa retry z narastającym odstępem. Każda próba renderuje aktualną treść, w tym kod i link portalu klienta.','ALL'),
('accounts-v020','Konta, role i blokady',ARRAY['konto','rola','uprawnienie','blokada','zablokować','zablokowac','odblokować','odblokowac','punkt użytkownika','punkt uzytkownika','wsparcie lockon'],'Konto ma jedną główną rolę biznesową oraz może mieć dodatkowe uprawnienie Wsparcie LockOn. Wsparcie nie musi zastępować roli Serwisanta, Koordynatora ani Pracownika punktu. Właściciel może zmienić rolę, przypisane punkty, parametry serwisanta i dodatkowe Wsparcie LockOn. Zablokowanie konta natychmiast unieważnia jego aktywne sesje i blokuje nowe logowanie.','OWNER'),
('support-handoff-v020','Bot i konsultant',ARRAY['konsultant','bot','wsparcie','czat','chat','dołącz','dolacz','aktywni użytkownicy','aktywni uzytkownicy'],'Rozmowa zaczyna się prywatnie z botem. Konsultant widzi, że użytkownik jest aktywny, ale nie widzi treści rozmowy, dopóki użytkownik nie wybierze prośby o konsultanta. Po prośbie rozmowa trafia do kolejki. Konsultant może dołączyć, odpowiadać i zamknąć rozmowę. Po dołączeniu człowieka bot przestaje automatycznie odpowiadać w tym wątku.','ALL'),
('finance-v020','Rozliczenia serwisowe',ARRAY['rozliczenie','udział serwisanta','udzial serwisanta','procent','przychód','przychod','snapshot','firma','boss'],'Rozliczenia automatyczne korzystają z procentu przypisanego do konkretnego serwisanta i zapisują jego wartość w momencie tworzenia wpisu przychodowego. Dzięki temu późniejsza zmiana procentu nie zmienia historii. Widok Szefa pokazuje przychód firmy, udział serwisantów, udział firmy i rozbicie na punkty oraz zlecenia.','ALL'),
('mobile-v020','Panel WWW i telefon',ARRAY['telefon','panel www','pwa','zaakceptować konto','zaakceptowac konto','wniosek','mobilny panel'],'Panel WWW/PWA korzysta z tych samych uprawnień backendowych co desktop. Właściciel może na telefonie zaakceptować oczekujący wniosek, ustawić główną rolę, punkty i dodatkowe Wsparcie LockOn, a także blokować konta. Odświeżenie PWA może wymagać przeładowania po aktualizacji service workera.','ALL'),
('diagnostics-v020','Narzędzia diagnostyczne bota',ARRAY['test internetu','prędkość internetu','predkosc internetu','speedtest','diagnostyka','api','film','youtube','tutorial','service manual','datasheet'],'Bot ma narzędzia lokalne: „test internetu” lub /net mierzy łącze na urządzeniu użytkownika; „diagnostyka połączenia” lub /diag sprawdza internet i centralne API ServiceOS; „film …” lub /video otwiera wyszukiwanie instruktaży YouTube; /web i pytania o service manual, datasheet lub schemat otwierają wyszukiwanie materiałów technicznych. Dla procedur sprzętowych zawsze sprawdź dokładny model i rewizję urządzenia przed wykonaniem czynności.','ALL')
ON CONFLICT (slug) DO UPDATE SET title=EXCLUDED.title,keywords=EXCLUDED.keywords,body=EXCLUDED.body,audience=EXCLUDED.audience,enabled=true,updated_at=now();

INSERT INTO schema_migrations(version,description)
VALUES ('2026-09-19-v020-assistant-knowledge','Expanded ServiceOS assistant knowledge and diagnostic tools')
ON CONFLICT (version) DO NOTHING;


-- 2026-09-20 v0.21: service finance, private invoice archive and technician workspace.
ALTER TABLE service_orders
  ADD COLUMN IF NOT EXISTS labor_cost_gross numeric(12,2),
  ADD COLUMN IF NOT EXISTS other_cost_gross numeric(12,2);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='service_orders_labor_cost_gross_check') THEN
    ALTER TABLE service_orders ADD CONSTRAINT service_orders_labor_cost_gross_check CHECK (labor_cost_gross IS NULL OR labor_cost_gross >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='service_orders_other_cost_gross_check') THEN
    ALTER TABLE service_orders ADD CONSTRAINT service_orders_other_cost_gross_check CHECK (other_cost_gross IS NULL OR other_cost_gross >= 0);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS service_order_parts (
  id text PRIMARY KEY,
  service_order_id text NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
  description text NOT NULL CHECK (char_length(btrim(description)) BETWEEN 1 AND 240),
  quantity numeric(10,2) NOT NULL DEFAULT 1 CHECK (quantity > 0 AND quantity <= 9999),
  unit_cost_gross numeric(12,2) NOT NULL DEFAULT 0 CHECK (unit_cost_gross >= 0),
  invoice_received boolean NOT NULL DEFAULT false,
  invoice_number text,
  supplier text,
  purchased_at date,
  created_by_user_id text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS service_order_parts_order_idx ON service_order_parts(service_order_id,created_at ASC);

CREATE TABLE IF NOT EXISTS service_order_invoices (
  id text PRIMARY KEY,
  service_order_id text NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
  uploaded_by_user_id text NOT NULL REFERENCES users(id),
  object_key text NOT NULL UNIQUE,
  file_name text NOT NULL,
  content_type text NOT NULL DEFAULT 'application/pdf' CHECK (content_type='application/pdf'),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 20971520),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  invoice_number text,
  supplier text,
  invoice_date date,
  gross_amount numeric(12,2) CHECK (gross_amount IS NULL OR gross_amount >= 0),
  status text NOT NULL DEFAULT 'UPLOADING' CHECK (status IN ('UPLOADING','READY','DELETED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  ready_at timestamptz,
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS service_order_invoices_order_idx ON service_order_invoices(service_order_id,created_at DESC);
CREATE INDEX IF NOT EXISTS service_order_invoices_month_idx ON service_order_invoices(invoice_date,created_at DESC) WHERE status='READY';

CREATE TABLE IF NOT EXISTS technician_private_notes (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text,
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 4000),
  pinned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS technician_private_notes_user_idx ON technician_private_notes(user_id,pinned DESC,updated_at DESC);

CREATE TABLE IF NOT EXISTS invoice_monthly_prompt_dismissals (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_month date NOT NULL,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,period_month)
);

INSERT INTO schema_migrations(version,description)
VALUES ('2026-09-20-v021-service-finance-invoices','Parts and labor costing, private PDF invoice archive, technician notes and monthly invoice prompt')
ON CONFLICT (version) DO NOTHING;


-- 2026-09-20 v1.0.0.0: service cards, customer QR and staff scan logistics.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='service_orders_handling_mode_check') THEN
    ALTER TABLE service_orders DROP CONSTRAINT service_orders_handling_mode_check;
  END IF;
  ALTER TABLE service_orders
    ADD CONSTRAINT service_orders_handling_mode_check
    CHECK (handling_mode IN ('STANDARD','COMPLAINT_FLOW','TRANSFER_ONLY'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS service_order_cards (
  service_order_id text PRIMARY KEY REFERENCES service_orders(id) ON DELETE CASCADE,
  print_mode text CHECK (print_mode IS NULL OR print_mode IN ('PHYSICAL_AND_ONLINE','ONLINE_ONLY')),
  staff_scan_token_hash text NOT NULL UNIQUE,
  staff_scan_token_ciphertext text NOT NULL,
  staff_scan_code_hash text NOT NULL UNIQUE,
  staff_scan_code_ciphertext text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  last_printed_at timestamptz,
  print_count integer NOT NULL DEFAULT 0 CHECK (print_count >= 0),
  customer_email_sent_at timestamptz,
  customer_email_last_error text,
  last_scanned_at timestamptz,
  last_scanned_by_user_id text REFERENCES users(id),
  last_scan_point_id text REFERENCES points(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS service_order_cards_scan_token_idx ON service_order_cards(staff_scan_token_hash);
CREATE INDEX IF NOT EXISTS service_order_cards_scan_code_idx ON service_order_cards(staff_scan_code_hash);

INSERT INTO schema_migrations(version,description)
VALUES ('2026-09-20-v1000-service-cards','A4 service cards, customer auto-login QR, staff scan QR and automatic intake handling')
ON CONFLICT (version) DO NOTHING;


-- 2026-09-22 ServiceOS 1.0.0.14: persistent technician plan ordering.
ALTER TABLE service_orders
  ADD COLUMN IF NOT EXISTS plan_position integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS service_orders_technician_plan_idx
  ON service_orders(assigned_technician_id,estimated_completion_at,plan_position,created_at)
  WHERE assigned_technician_id IS NOT NULL AND status NOT IN ('COMPLETED','CANCELLED','REJECTED');
INSERT INTO schema_migrations(version,description)
VALUES ('2026-09-22-v100014-service-plan-order','Persistent drag-and-drop technician plan ordering')
ON CONFLICT (version) DO NOTHING;


-- 2026-09-22 ServiceOS 1.0.0.14: mandatory service warranty before READY.
ALTER TABLE service_orders
  ADD COLUMN IF NOT EXISTS warranty_months integer,
  ADD COLUMN IF NOT EXISTS warranty_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS warranty_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS warranty_card_printed_at timestamptz,
  ADD COLUMN IF NOT EXISTS warranty_card_print_count integer NOT NULL DEFAULT 0;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='service_orders_warranty_months_check') THEN
    ALTER TABLE service_orders ADD CONSTRAINT service_orders_warranty_months_check CHECK (warranty_months IS NULL OR (warranty_months >= 1 AND warranty_months <= 60));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='service_orders_warranty_print_count_check') THEN
    ALTER TABLE service_orders ADD CONSTRAINT service_orders_warranty_print_count_check CHECK (warranty_card_print_count >= 0);
  END IF;
END $$;
INSERT INTO schema_migrations(version,description)
VALUES ('2026-09-22-v100014-service-warranty','Mandatory service warranty and warranty card before READY')
ON CONFLICT (version) DO NOTHING;


-- 2026-09-24 ServiceOS 1.0.0.20: meetings / trainings / webinars.
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
  CHECK ((audience_type='ALL' AND point_id IS NULL AND user_id IS NULL) OR (audience_type='POINT' AND point_id IS NOT NULL AND user_id IS NULL) OR (audience_type='USER' AND user_id IS NOT NULL AND point_id IS NULL))
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
