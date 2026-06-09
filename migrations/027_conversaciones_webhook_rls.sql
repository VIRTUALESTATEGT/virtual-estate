-- Migration 027: Allow webhook (unauthenticated) to insert conversations and messages.
-- Webhooks (WhatsApp/Instagram) call Supabase without a JWT, so anon policies are needed.

-- conversaciones_multicanal
DROP POLICY IF EXISTS "conversaciones_anon_insert" ON conversaciones_multicanal;
CREATE POLICY "conversaciones_anon_insert"
  ON conversaciones_multicanal FOR INSERT
  TO anon
  WITH CHECK (true);

DROP POLICY IF EXISTS "conversaciones_anon_select" ON conversaciones_multicanal;
CREATE POLICY "conversaciones_anon_select"
  ON conversaciones_multicanal FOR SELECT
  TO anon
  USING (true);

-- mensajes
DROP POLICY IF EXISTS "mensajes_anon_insert" ON mensajes;
CREATE POLICY "mensajes_anon_insert"
  ON mensajes FOR INSERT
  TO anon
  WITH CHECK (true);
