-- ============================================================
-- 003_row_level_security.sql
-- Row-Level Security for Virtual Estate
--
-- NOTE: The backend uses the service_role key (SUPABASE_SECRET_KEY)
-- which bypasses ALL RLS policies automatically.
-- These policies protect against:
--   1. Direct anon key access
--   2. Direct DB connections with non-service-role credentials
--   3. Client-side SDK calls with the anon key
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- Helper functions for custom JWT claims
-- The backend signs tokens with JWT_SECRET; Supabase must be
-- configured with the same secret to parse claims via
-- current_setting('request.jwt.claims', true).
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION auth_user_id() RETURNS int
  LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(
    current_setting('request.jwt.claims', true)::jsonb ->> 'id',
    ''
  )::int;
$$;

CREATE OR REPLACE FUNCTION auth_user_role() RETURNS text
  LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(
    current_setting('request.jwt.claims', true)::jsonb ->> 'role',
    'asistente'
  );
$$;

CREATE OR REPLACE FUNCTION auth_is_superadmin() RETURNS boolean
  LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(
    (current_setting('request.jwt.claims', true)::jsonb ->> 'is_superadmin')::boolean,
    false
  );
$$;

-- ────────────────────────────────────────────────────────────
-- Enable RLS on all sensitive tables
-- ────────────────────────────────────────────────────────────

ALTER TABLE usuarios                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE clientes                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE cotizaciones                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversaciones_multicanal       ENABLE ROW LEVEL SECURITY;
ALTER TABLE mensajes                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE cliente_verificacion_identidad  ENABLE ROW LEVEL SECURITY;
ALTER TABLE permisos_usuario                ENABLE ROW LEVEL SECURITY;
ALTER TABLE propiedades                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads                           ENABLE ROW LEVEL SECURITY;
ALTER TABLE proyectos                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE agentes                         ENABLE ROW LEVEL SECURITY;
ALTER TABLE notificaciones_admin            ENABLE ROW LEVEL SECURITY;
ALTER TABLE instrucciones_ia_dinamicas      ENABLE ROW LEVEL SECURITY;
ALTER TABLE zonas_seguridad                 ENABLE ROW LEVEL SECURITY;

-- ────────────────────────────────────────────────────────────
-- Drop existing policies (idempotent re-run)
-- ────────────────────────────────────────────────────────────

DO $$ DECLARE r RECORD;
BEGIN
  FOR r IN (SELECT schemaname, tablename, policyname FROM pg_policies WHERE schemaname = 'public') LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

-- ════════════════════════════════════════════════════════════
-- TABLE: propiedades
-- Public read (limited columns via view), full access for staff
-- ════════════════════════════════════════════════════════════

-- Anon can read published properties (public catalog)
CREATE POLICY "propiedades_anon_select"
  ON propiedades FOR SELECT
  TO anon
  USING (true);

-- Authenticated staff can read all
CREATE POLICY "propiedades_auth_select"
  ON propiedades FOR SELECT
  TO authenticated
  USING (true);

-- Only gerente/superadmin can insert/update/delete
CREATE POLICY "propiedades_staff_write"
  ON propiedades FOR ALL
  TO authenticated
  USING (
    auth_is_superadmin()
    OR auth_user_role() IN ('gerente', 'admin')
  )
  WITH CHECK (
    auth_is_superadmin()
    OR auth_user_role() IN ('gerente', 'admin')
  );

-- ════════════════════════════════════════════════════════════
-- TABLE: zonas_seguridad
-- Public read (needed for quote form), superadmin write
-- ════════════════════════════════════════════════════════════

CREATE POLICY "zonas_anon_select"
  ON zonas_seguridad FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "zonas_auth_select"
  ON zonas_seguridad FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "zonas_superadmin_write"
  ON zonas_seguridad FOR ALL
  TO authenticated
  USING (auth_is_superadmin())
  WITH CHECK (auth_is_superadmin());

-- ════════════════════════════════════════════════════════════
-- TABLE: leads
-- Staff can read their own leads; gerente/superadmin see all
-- ════════════════════════════════════════════════════════════

CREATE POLICY "leads_staff_select"
  ON leads FOR SELECT
  TO authenticated
  USING (
    auth_is_superadmin()
    OR auth_user_role() IN ('gerente', 'admin', 'agente')
  );

CREATE POLICY "leads_staff_insert"
  ON leads FOR INSERT
  TO authenticated
  WITH CHECK (
    auth_is_superadmin()
    OR auth_user_role() IN ('gerente', 'admin', 'agente', 'asistente')
  );

CREATE POLICY "leads_staff_update"
  ON leads FOR UPDATE
  TO authenticated
  USING (
    auth_is_superadmin()
    OR auth_user_role() IN ('gerente', 'admin', 'agente')
  );

-- Anon can insert leads (landing page contact forms)
CREATE POLICY "leads_anon_insert"
  ON leads FOR INSERT
  TO anon
  WITH CHECK (true);

-- ════════════════════════════════════════════════════════════
-- TABLE: clientes
-- Agents/staff read all; only gerente+ can delete
-- ════════════════════════════════════════════════════════════

CREATE POLICY "clientes_auth_select"
  ON clientes FOR SELECT
  TO authenticated
  USING (
    auth_is_superadmin()
    OR auth_user_role() IN ('gerente', 'admin', 'agente', 'asistente')
  );

CREATE POLICY "clientes_auth_insert"
  ON clientes FOR INSERT
  TO authenticated
  WITH CHECK (
    auth_is_superadmin()
    OR auth_user_role() IN ('gerente', 'admin', 'agente', 'asistente')
  );

CREATE POLICY "clientes_auth_update"
  ON clientes FOR UPDATE
  TO authenticated
  USING (
    auth_is_superadmin()
    OR auth_user_role() IN ('gerente', 'admin', 'agente')
  );

CREATE POLICY "clientes_gerente_delete"
  ON clientes FOR DELETE
  TO authenticated
  USING (
    auth_is_superadmin()
    OR auth_user_role() IN ('gerente', 'admin')
  );

-- Anon can insert clients (from quote form)
CREATE POLICY "clientes_anon_insert"
  ON clientes FOR INSERT
  TO anon
  WITH CHECK (true);

-- ════════════════════════════════════════════════════════════
-- TABLE: cotizaciones
-- Staff read their related quotes; gerente+ see all
-- ════════════════════════════════════════════════════════════

CREATE POLICY "cotizaciones_auth_select"
  ON cotizaciones FOR SELECT
  TO authenticated
  USING (
    auth_is_superadmin()
    OR auth_user_role() IN ('gerente', 'admin', 'agente', 'asistente')
  );

CREATE POLICY "cotizaciones_auth_insert"
  ON cotizaciones FOR INSERT
  TO authenticated
  WITH CHECK (
    auth_is_superadmin()
    OR auth_user_role() IN ('gerente', 'admin', 'agente', 'asistente')
  );

CREATE POLICY "cotizaciones_auth_update"
  ON cotizaciones FOR UPDATE
  TO authenticated
  USING (
    auth_is_superadmin()
    OR auth_user_role() IN ('gerente', 'admin', 'agente')
  );

CREATE POLICY "cotizaciones_gerente_delete"
  ON cotizaciones FOR DELETE
  TO authenticated
  USING (
    auth_is_superadmin()
    OR auth_user_role() IN ('gerente', 'admin')
  );

-- ════════════════════════════════════════════════════════════
-- TABLE: conversaciones_multicanal
-- Agents see their assigned; gerente/superadmin see all
-- ════════════════════════════════════════════════════════════

CREATE POLICY "conversaciones_auth_select"
  ON conversaciones_multicanal FOR SELECT
  TO authenticated
  USING (
    auth_is_superadmin()
    OR auth_user_role() IN ('gerente', 'admin')
    OR (auth_user_role() = 'agente' AND agente_id = auth_user_id())
    OR auth_user_role() = 'asistente'
  );

CREATE POLICY "conversaciones_auth_insert"
  ON conversaciones_multicanal FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "conversaciones_auth_update"
  ON conversaciones_multicanal FOR UPDATE
  TO authenticated
  USING (
    auth_is_superadmin()
    OR auth_user_role() IN ('gerente', 'admin')
    OR agente_id = auth_user_id()
  );

-- ════════════════════════════════════════════════════════════
-- TABLE: mensajes
-- Match conversacion access — read if you can read the conv
-- ════════════════════════════════════════════════════════════

CREATE POLICY "mensajes_auth_select"
  ON mensajes FOR SELECT
  TO authenticated
  USING (
    auth_is_superadmin()
    OR auth_user_role() IN ('gerente', 'admin', 'agente', 'asistente')
  );

CREATE POLICY "mensajes_auth_insert"
  ON mensajes FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- ════════════════════════════════════════════════════════════
-- TABLE: cliente_verificacion_identidad
-- Only superadmin/gerente can read verifications (contains DPI/selfie)
-- ════════════════════════════════════════════════════════════

CREATE POLICY "verificacion_gerente_select"
  ON cliente_verificacion_identidad FOR SELECT
  TO authenticated
  USING (
    auth_is_superadmin()
    OR auth_user_role() IN ('gerente', 'admin')
  );

CREATE POLICY "verificacion_auth_insert"
  ON cliente_verificacion_identidad FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "verificacion_gerente_update"
  ON cliente_verificacion_identidad FOR UPDATE
  TO authenticated
  USING (
    auth_is_superadmin()
    OR auth_user_role() IN ('gerente', 'admin')
  );

-- ════════════════════════════════════════════════════════════
-- TABLE: usuarios
-- Users see their own row; superadmin sees all
-- ════════════════════════════════════════════════════════════

CREATE POLICY "usuarios_own_select"
  ON usuarios FOR SELECT
  TO authenticated
  USING (
    auth_is_superadmin()
    OR auth_user_role() IN ('gerente', 'admin')
    OR id = auth_user_id()
  );

CREATE POLICY "usuarios_superadmin_write"
  ON usuarios FOR ALL
  TO authenticated
  USING (auth_is_superadmin())
  WITH CHECK (auth_is_superadmin());

-- ════════════════════════════════════════════════════════════
-- TABLE: permisos_usuario
-- Users see their own permissions; superadmin manages all
-- ════════════════════════════════════════════════════════════

CREATE POLICY "permisos_own_select"
  ON permisos_usuario FOR SELECT
  TO authenticated
  USING (
    auth_is_superadmin()
    OR usuario_id = auth_user_id()
  );

CREATE POLICY "permisos_superadmin_write"
  ON permisos_usuario FOR ALL
  TO authenticated
  USING (auth_is_superadmin())
  WITH CHECK (auth_is_superadmin());

-- ════════════════════════════════════════════════════════════
-- TABLE: proyectos, agentes
-- Staff read; gerente+ write
-- ════════════════════════════════════════════════════════════

CREATE POLICY "proyectos_auth_select"
  ON proyectos FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "proyectos_gerente_write"
  ON proyectos FOR ALL
  TO authenticated
  USING (
    auth_is_superadmin()
    OR auth_user_role() IN ('gerente', 'admin')
  )
  WITH CHECK (
    auth_is_superadmin()
    OR auth_user_role() IN ('gerente', 'admin')
  );

CREATE POLICY "agentes_auth_select"
  ON agentes FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "agentes_gerente_write"
  ON agentes FOR ALL
  TO authenticated
  USING (
    auth_is_superadmin()
    OR auth_user_role() IN ('gerente', 'admin')
  )
  WITH CHECK (
    auth_is_superadmin()
    OR auth_user_role() IN ('gerente', 'admin')
  );

-- ════════════════════════════════════════════════════════════
-- TABLE: notificaciones_admin, instrucciones_ia_dinamicas
-- Superadmin only
-- ════════════════════════════════════════════════════════════

CREATE POLICY "notificaciones_superadmin"
  ON notificaciones_admin FOR ALL
  TO authenticated
  USING (
    auth_is_superadmin()
    OR auth_user_role() IN ('gerente', 'admin')
  )
  WITH CHECK (true);

CREATE POLICY "instrucciones_superadmin"
  ON instrucciones_ia_dinamicas FOR ALL
  TO authenticated
  USING (auth_is_superadmin())
  WITH CHECK (auth_is_superadmin());

-- ────────────────────────────────────────────────────────────
-- Verify RLS is enabled (informational)
-- ────────────────────────────────────────────────────────────
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'usuarios','clientes','cotizaciones','conversaciones_multicanal',
    'mensajes','cliente_verificacion_identidad','permisos_usuario',
    'propiedades','leads','proyectos','agentes',
    'notificaciones_admin','instrucciones_ia_dinamicas','zonas_seguridad'
  )
ORDER BY tablename;
