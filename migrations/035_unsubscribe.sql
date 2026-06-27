-- Migration 035: opt-out / unsubscribe para emails de seguimiento en tabla clientes
ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS email_opt_out      BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS unsubscribe_token  TEXT    UNIQUE;

-- Genera token único para clientes existentes (y nuevos que aún no tengan)
UPDATE clientes
  SET unsubscribe_token = gen_random_uuid()::TEXT
  WHERE unsubscribe_token IS NULL;

-- Índice para lookup rápido por token (el endpoint público lo usa)
CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_unsubscribe_token
  ON clientes (unsubscribe_token)
  WHERE unsubscribe_token IS NOT NULL;
