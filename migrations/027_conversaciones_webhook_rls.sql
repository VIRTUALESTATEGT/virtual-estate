-- Migration 027: Allow webhook (unauthenticated service_role) to insert
-- conversations and messages from WhatsApp/Instagram webhooks.
--
-- The backend uses SUPABASE_SECRET_KEY (service_role) which bypasses RLS.
-- However, if the key is missing the client falls back to anon, which needs
-- explicit policies. These policies also allow the webhook anon path.

-- conversaciones_multicanal: allow anon insert (webhooks don't carry JWT)
CREATE POLICY IF NOT EXISTS "conversaciones_anon_insert"
  ON conversaciones_multicanal FOR INSERT
  TO anon
  WITH CHECK (true);

-- conversaciones_multicanal: allow anon select (for find-or-create pattern)
CREATE POLICY IF NOT EXISTS "conversaciones_anon_select"
  ON conversaciones_multicanal FOR SELECT
  TO anon
  USING (true);

-- mensajes: allow anon insert
CREATE POLICY IF NOT EXISTS "mensajes_anon_insert"
  ON mensajes FOR INSERT
  TO anon
  WITH CHECK (true);
