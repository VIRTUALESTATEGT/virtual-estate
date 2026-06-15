-- Migration 031: Safety-net RLS policies for Instagram webhook on conversaciones_multicanal
-- Instagram uses service_role (SUPABASE_SECRET_KEY) which bypasses RLS,
-- so these policies are defensive — they protect against any future fallback to anon key.
-- Idempotent: DROP IF EXISTS before CREATE.

DROP POLICY IF EXISTS "conversaciones_anon_select" ON conversaciones_multicanal;
CREATE POLICY "conversaciones_anon_select"
  ON conversaciones_multicanal FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "conversaciones_anon_insert" ON conversaciones_multicanal;
CREATE POLICY "conversaciones_anon_insert"
  ON conversaciones_multicanal FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS "mensajes_anon_insert" ON mensajes;
CREATE POLICY "mensajes_anon_insert"
  ON mensajes FOR INSERT TO anon WITH CHECK (true);
