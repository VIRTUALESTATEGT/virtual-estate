-- Migration 011: Historial de mensajes WhatsApp

CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id           BIGSERIAL PRIMARY KEY,
  phone_number TEXT NOT NULL,
  message      TEXT NOT NULL,
  message_id   TEXT,
  direction    TEXT CHECK (direction IN ('incoming', 'outgoing')),
  timestamp    TIMESTAMP DEFAULT NOW(),
  created_at   TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_phone_timestamp ON whatsapp_messages(phone_number, timestamp DESC);

ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;
