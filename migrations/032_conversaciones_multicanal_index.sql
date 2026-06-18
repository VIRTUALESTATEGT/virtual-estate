-- Migration 032: Index on conversaciones_multicanal(creada_por_cliente, estado)
--
-- Root-cause fix for Instagram webhook cold-start hangs.
-- Without this index, the SELECT that looks up an active conversation by PSID/phone
-- does a full scan of all 'activa' rows (using only idx_conv_estado), which is slow
-- and can exceed Vercel's 60s function limit when combined with cold-start HTTPS
-- connection establishment to Supabase.
--
-- With this composite index, the lookup becomes a direct index seek: O(log n) instead
-- of O(active_rows), making it as fast as whatsapp_messages(phone_number) lookups.
--
-- Run in: Supabase Dashboard → SQL Editor

CREATE INDEX IF NOT EXISTS idx_conv_creada_por_cliente
  ON conversaciones_multicanal(creada_por_cliente, estado);
