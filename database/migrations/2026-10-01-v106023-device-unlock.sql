-- ServiceOS 1.0.6.23: protected phone unlock data captured at service intake.
-- Additive only. No existing service order or device row is modified.

CREATE TABLE IF NOT EXISTS service_order_device_unlock (
  service_order_id text PRIMARY KEY REFERENCES service_orders(id) ON DELETE CASCADE,
  unlock_type text NOT NULL,
  secret_ciphertext text,
  updated_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_order_device_unlock_type_check
    CHECK (unlock_type IN ('NONE','PIN','PATTERN')),
  CONSTRAINT service_order_device_unlock_payload_check
    CHECK (
      (unlock_type = 'NONE' AND secret_ciphertext IS NULL)
      OR
      (unlock_type IN ('PIN','PATTERN') AND secret_ciphertext IS NOT NULL AND char_length(secret_ciphertext) >= 24)
    )
);

CREATE INDEX IF NOT EXISTS service_order_device_unlock_updated_idx
  ON service_order_device_unlock(updated_at DESC);

INSERT INTO schema_migrations(version,description)
VALUES (
  '2026-10-01-v106023-device-unlock',
  'Encrypted phone PIN or pattern metadata for service intake'
)
ON CONFLICT (version) DO NOTHING;
