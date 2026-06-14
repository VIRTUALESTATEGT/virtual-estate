-- Migration 030: Rate limiting table (Supabase-backed, works in serverless)
-- Tracks failed login attempts per IP. No anon policies — only service_role accesses this.

CREATE TABLE IF NOT EXISTS rate_limit_intentos (
  id            BIGSERIAL PRIMARY KEY,
  ip            TEXT        NOT NULL,
  endpoint      TEXT        NOT NULL,
  intentos      INTEGER     NOT NULL DEFAULT 0,
  ventana_inicio TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rate_limit_ip_endpoint
  ON rate_limit_intentos(ip, endpoint);

ALTER TABLE rate_limit_intentos ENABLE ROW LEVEL SECURITY;
-- No policies — service_role bypasses RLS; no anon or authenticated access needed
