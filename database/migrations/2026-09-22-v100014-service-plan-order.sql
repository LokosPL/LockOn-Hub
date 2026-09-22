-- ServiceOS 1.0.0.14 — persistent technician work-plan ordering.
-- Additive migration. No existing service data is rewritten or deleted.

ALTER TABLE service_orders
  ADD COLUMN IF NOT EXISTS plan_position integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS service_orders_technician_plan_idx
  ON service_orders(assigned_technician_id, estimated_completion_at, plan_position, created_at)
  WHERE assigned_technician_id IS NOT NULL
    AND status NOT IN ('COMPLETED','CANCELLED','REJECTED');

INSERT INTO schema_migrations(version,description)
VALUES ('2026-09-22-v100014-service-plan-order','Persistent drag-and-drop technician plan ordering')
ON CONFLICT (version) DO NOTHING;
