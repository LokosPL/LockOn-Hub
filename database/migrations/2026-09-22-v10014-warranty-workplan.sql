-- ServiceOS 1.0.0.14 — warranty workflow and technician work-plan ordering.
-- Additive migration. Existing orders remain valid and receive no warranty retroactively.

ALTER TABLE service_orders
  ADD COLUMN IF NOT EXISTS warranty_months integer,
  ADD COLUMN IF NOT EXISTS warranty_issued_at timestamptz,
  ADD COLUMN IF NOT EXISTS warranty_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS warranty_card_printed_at timestamptz,
  ADD COLUMN IF NOT EXISTS work_queue_position integer NOT NULL DEFAULT 1000;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='service_orders'::regclass
      AND conname='service_orders_warranty_months_check'
  ) THEN
    ALTER TABLE service_orders
      ADD CONSTRAINT service_orders_warranty_months_check
      CHECK (warranty_months IS NULL OR warranty_months BETWEEN 1 AND 60);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='service_orders'::regclass
      AND conname='service_orders_warranty_dates_check'
  ) THEN
    ALTER TABLE service_orders
      ADD CONSTRAINT service_orders_warranty_dates_check
      CHECK (
        warranty_expires_at IS NULL OR
        warranty_issued_at IS NULL OR
        warranty_expires_at > warranty_issued_at
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS service_orders_technician_plan_idx
  ON service_orders(assigned_technician_id,estimated_completion_at,work_queue_position)
  WHERE status NOT IN ('COMPLETED','CANCELLED','REJECTED');

INSERT INTO schema_migrations(version,description)
VALUES ('2026-09-22-v10014-warranty-workplan','Warranty card workflow, customer warranty dates and technician day ordering')
ON CONFLICT (version) DO NOTHING;
