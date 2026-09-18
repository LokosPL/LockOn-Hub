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
  notify_statuses text[] NOT NULL DEFAULT ARRAY['RECEIVED','DIAGNOSIS','WAITING_PARTS','IN_REPAIR','READY','COMPLETED','REJECTED']::text[],
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
  SET DEFAULT ARRAY['RECEIVED','DIAGNOSIS','WAITING_PARTS','IN_REPAIR','READY','COMPLETED','REJECTED']::text[];

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
