-- ServiceOS 1.0.0.14 — performed repair description for warranty documents.
-- Additive only: no existing data is changed or removed.

ALTER TABLE service_orders
  ADD COLUMN IF NOT EXISTS repair_summary text;

INSERT INTO schema_migrations(version,description)
VALUES ('2026-09-22-v100014-warranty-repair-summary','Performed repair summary stored with service warranty')
ON CONFLICT (version) DO NOTHING;
