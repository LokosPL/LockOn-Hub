BEGIN;

ALTER TABLE service_orders
  ADD COLUMN IF NOT EXISTS repair_summary text,
  ADD COLUMN IF NOT EXISTS warranty_months integer,
  ADD COLUMN IF NOT EXISTS warranty_start_at timestamptz,
  ADD COLUMN IF NOT EXISTS warranty_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS warranty_card_number text,
  ADD COLUMN IF NOT EXISTS warranty_card_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS workday_sort_order integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='service_orders_warranty_months_check') THEN
    ALTER TABLE service_orders
      ADD CONSTRAINT service_orders_warranty_months_check
      CHECK (warranty_months IS NULL OR (warranty_months >= 1 AND warranty_months <= 120));
  END IF;
END $$;

ALTER TABLE service_orders DROP CONSTRAINT IF EXISTS service_orders_status_check;
ALTER TABLE service_orders
  ADD CONSTRAINT service_orders_status_check
  CHECK (status IN ('RECEIVED','DIAGNOSIS','WAITING_PARTS','IN_REPAIR','TESTING','REPAIR_DONE','READY','COMPLETED','CANCELLED','REJECTED'));

CREATE UNIQUE INDEX IF NOT EXISTS service_orders_warranty_card_number_uq
  ON service_orders(warranty_card_number)
  WHERE warranty_card_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS service_orders_workday_sort_idx
  ON service_orders(assigned_technician_id, estimated_completion_at, workday_sort_order, updated_at DESC)
  WHERE assigned_technician_id IS NOT NULL AND estimated_completion_at IS NOT NULL;

INSERT INTO schema_migrations(version)
VALUES ('2026-09-22-v1014-warranty-workplan')
ON CONFLICT (version) DO NOTHING;

COMMIT;
