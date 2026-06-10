-- Migration 029: Meta platform tokens (Instagram, Messenger)
-- Stores long-lived tokens and their expiry so the backend never relies on env vars alone.

CREATE TABLE IF NOT EXISTS meta_tokens (
  id          BIGSERIAL PRIMARY KEY,
  platform    TEXT        NOT NULL,  -- 'instagram' | 'messenger'
  token       TEXT        NOT NULL,
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_tokens_platform ON meta_tokens(platform);
