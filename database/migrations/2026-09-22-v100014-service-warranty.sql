-- ServiceOS 1.0.0.14 — mandatory service warranty before READY.
-- Additive only: existing orders remain untouched and no data is deleted.

ALTER TABLE service_orders
  ADD COLUMN IF NOT EXISTS warranty_months integer,
  ADD COLUMN IF NOT EXISTS warranty_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS warranty_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS warranty_card_printed_at timestamptz,
  ADD COLUMN IF NOT EXISTS warranty_card_print_count integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='service_orders_warranty_months_check') THEN
    ALTER TABLE service_orders
      ADD CONSTRAINT service_orders_warranty_months_check
      CHECK (warranty_months IS NULL OR (warranty_months >= 1 AND warranty_months <= 60));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='service_orders_warranty_print_count_check') THEN
    ALTER TABLE service_orders
      ADD CONSTRAINT service_orders_warranty_print_count_check
      CHECK (warranty_card_print_count >= 0);
  END IF;
END $$;

INSERT INTO schema_migrations(version,description)
VALUES ('2026-09-22-v100014-service-warranty','Mandatory service warranty and warranty card before READY')
ON CONFLICT (version) DO NOTHING;
