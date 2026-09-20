-- v1.0.0.0 service cards, automatic intake flow and staff QR logistics.
-- Additive except widening the allowed handling_mode values.

DO $$
DECLARE
  current_definition text;
BEGIN
  SELECT pg_get_constraintdef(oid)
    INTO current_definition
    FROM pg_constraint
   WHERE conrelid='service_orders'::regclass
     AND conname='service_orders_handling_mode_check';

  IF current_definition IS NULL OR position('COMPLAINT_FLOW' in current_definition)=0 THEN
    IF NOT EXISTS (
      SELECT 1
        FROM pg_constraint
       WHERE conrelid='service_orders'::regclass
         AND conname='service_orders_handling_mode_v1000_check'
    ) THEN
      ALTER TABLE service_orders
        ADD CONSTRAINT service_orders_handling_mode_v1000_check
        CHECK (handling_mode IN ('STANDARD','COMPLAINT_FLOW','TRANSFER_ONLY')) NOT VALID;
    END IF;

    ALTER TABLE service_orders
      VALIDATE CONSTRAINT service_orders_handling_mode_v1000_check;

    IF current_definition IS NOT NULL THEN
      ALTER TABLE service_orders
        DROP CONSTRAINT service_orders_handling_mode_check;
    END IF;

    ALTER TABLE service_orders
      RENAME CONSTRAINT service_orders_handling_mode_v1000_check
      TO service_orders_handling_mode_check;
  END IF;
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
