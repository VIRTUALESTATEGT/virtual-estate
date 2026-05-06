-- ============================================================
-- Migration 004: RLS para propiedades_adicionales y propiedades_favoritos
-- ============================================================

-- Habilitar RLS
ALTER TABLE propiedades_adicionales ENABLE ROW LEVEL SECURITY;
ALTER TABLE propiedades_favoritos   ENABLE ROW LEVEL SECURITY;

-- ════════════════════════════════════════════════════════════
-- TABLE: propiedades_adicionales
-- Lectura pública (filtros del catálogo), escritura solo admin+
-- ════════════════════════════════════════════════════════════

CREATE POLICY "prop_adicionales_anon_select"
  ON propiedades_adicionales FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "prop_adicionales_auth_select"
  ON propiedades_adicionales FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "prop_adicionales_admin_write"
  ON propiedades_adicionales FOR ALL
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
-- TABLE: propiedades_favoritos
-- Cliente: solo sus propios favoritos (cliente_id = su id en JWT)
-- Gerente/admin/superadmin: ven todo
-- Anon y otros roles: sin acceso
-- ════════════════════════════════════════════════════════════

CREATE POLICY "favoritos_cliente_select"
  ON propiedades_favoritos FOR SELECT
  TO authenticated
  USING (
    auth_is_superadmin()
    OR auth_user_role() IN ('gerente', 'admin')
    OR cliente_id = auth_user_id()
  );

CREATE POLICY "favoritos_cliente_insert"
  ON propiedades_favoritos FOR INSERT
  TO authenticated
  WITH CHECK (
    auth_is_superadmin()
    OR auth_user_role() IN ('gerente', 'admin')
    OR cliente_id = auth_user_id()
  );

CREATE POLICY "favoritos_cliente_delete"
  ON propiedades_favoritos FOR DELETE
  TO authenticated
  USING (
    auth_is_superadmin()
    OR auth_user_role() IN ('gerente', 'admin')
    OR cliente_id = auth_user_id()
  );

-- Verificar
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('propiedades_adicionales', 'propiedades_favoritos')
ORDER BY tablename;
