-- v0.21 service finance, invoice archive and technician workspace.
-- Additive only: no existing rows are deleted or rewritten.

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
CREATE INDEX IF NOT EXISTS service_order_parts_order_idx
  ON service_order_parts(service_order_id,created_at ASC);

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
CREATE INDEX IF NOT EXISTS service_order_invoices_order_idx
  ON service_order_invoices(service_order_id,created_at DESC);
CREATE INDEX IF NOT EXISTS service_order_invoices_month_idx
  ON service_order_invoices(invoice_date,created_at DESC)
  WHERE status='READY';

CREATE TABLE IF NOT EXISTS technician_private_notes (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text,
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 4000),
  pinned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS technician_private_notes_user_idx
  ON technician_private_notes(user_id,pinned DESC,updated_at DESC);

CREATE TABLE IF NOT EXISTS invoice_monthly_prompt_dismissals (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_month date NOT NULL,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,period_month)
);

INSERT INTO schema_migrations(version,description)
VALUES ('2026-09-20-v021-service-finance-invoices','Parts and labor costing, private PDF invoice archive, technician notes and monthly invoice prompt')
ON CONFLICT (version) DO NOTHING;
