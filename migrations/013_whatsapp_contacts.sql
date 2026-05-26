-- Migration 013: WhatsApp contacts (owner numbers + client list)

CREATE TABLE IF NOT EXISTS whatsapp_contacts (
  id           BIGSERIAL PRIMARY KEY,
  phone_number TEXT NOT NULL UNIQUE,
  contact_type TEXT NOT NULL DEFAULT 'client' CHECK (contact_type IN ('owner', 'client', 'personal')),
  name         TEXT,
  respond      BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMP DEFAULT NOW(),
  updated_at   TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wa_contacts_phone ON whatsapp_contacts(phone_number);

-- Owner numbers (auto-respond disabled — command mode only)
INSERT INTO whatsapp_contacts (phone_number, contact_type, name, respond)
VALUES
  ('50239902399', 'owner', 'Virtual Estate Business', false),
  ('50250175832', 'owner', 'Hector Personal',         false)
ON CONFLICT (phone_number) DO NOTHING;

ALTER TABLE whatsapp_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all_contacts" ON whatsapp_contacts
  FOR ALL USING (true) WITH CHECK (true);
