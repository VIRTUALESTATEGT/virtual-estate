-- 080_modo_humano.sql
-- Agrega flag de modo humano (pausa del bot) a WhatsApp y canales multicanal.

-- Canal WhatsApp: estado por número de teléfono
ALTER TABLE whatsapp_contacts
  ADD COLUMN IF NOT EXISTS modo_humano        BOOLEAN     DEFAULT false,
  ADD COLUMN IF NOT EXISTS modo_humano_desde  TIMESTAMPTZ;

-- Canales Instagram / Messenger: estado por conversación
ALTER TABLE conversaciones_multicanal
  ADD COLUMN IF NOT EXISTS modo_humano        BOOLEAN     DEFAULT false,
  ADD COLUMN IF NOT EXISTS modo_humano_desde  TIMESTAMPTZ;
