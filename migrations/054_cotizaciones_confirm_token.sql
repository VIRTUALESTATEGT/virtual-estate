-- Migration 054: add confirm_token to cotizaciones for IDOR-safe confirmation links
-- Postgres backfills existing rows automatically via the DEFAULT expression;
-- the UPDATE is an explicit safety net for any edge-case NULLs.

ALTER TABLE cotizaciones
  ADD COLUMN IF NOT EXISTS confirm_token UUID DEFAULT gen_random_uuid();

UPDATE cotizaciones
SET confirm_token = gen_random_uuid()
WHERE confirm_token IS NULL;

ALTER TABLE cotizaciones
  ALTER COLUMN confirm_token SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS cotizaciones_confirm_token_idx
  ON cotizaciones (confirm_token);
