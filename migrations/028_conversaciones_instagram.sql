-- Migration 028: Minimal Instagram conversations table (no RLS)
CREATE TABLE IF NOT EXISTS conversaciones_instagram (
  id         BIGSERIAL PRIMARY KEY,
  psid       TEXT NOT NULL,
  canal      TEXT DEFAULT 'instagram',
  estado     TEXT DEFAULT 'activa',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversaciones_instagram_psid
  ON conversaciones_instagram(psid);
