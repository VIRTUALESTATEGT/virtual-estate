-- ══════════════════════════════════════════════════════════════════════════════
-- Migración 064: Galería de fotos por propiedad
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- ══════════════════════════════════════════════════════════════════════════════

-- ─── 1. COLUMNA EN propiedades ────────────────────────────────────────────────
-- URL desnormalizada de la foto de portada. Se actualiza cada vez que el admin
-- cambia la portada o elimina fotos. Evita un JOIN para renderizar el catálogo.

ALTER TABLE propiedades
  ADD COLUMN IF NOT EXISTS foto_principal_url TEXT;

-- ─── 2. TABLA propiedad_fotos ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS propiedad_fotos (
  id              BIGSERIAL PRIMARY KEY,
  propiedad_id    BIGINT    NOT NULL REFERENCES propiedades(id) ON DELETE CASCADE,
  url             TEXT      NOT NULL,
  storage_path    TEXT      NOT NULL,   -- path en Supabase Storage para poder borrar el objeto
  orden           INT       NOT NULL DEFAULT 0,
  es_principal    BOOLEAN   NOT NULL DEFAULT FALSE,
  nombre_archivo  TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 3. ÍNDICES ───────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_propiedad_fotos_propiedad
  ON propiedad_fotos(propiedad_id, orden);

-- ─── 4. RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE propiedad_fotos ENABLE ROW LEVEL SECURITY;

-- Anon puede leer (necesario para el catálogo público)
CREATE POLICY "propiedad_fotos_anon_select"
  ON propiedad_fotos FOR SELECT
  TO anon
  USING (true);

-- Staff autenticado puede leer todo
CREATE POLICY "propiedad_fotos_auth_select"
  ON propiedad_fotos FOR SELECT
  TO authenticated
  USING (true);

-- Solo superadmin / gerente / admin pueden escribir (mismo criterio que propiedades)
CREATE POLICY "propiedad_fotos_staff_write"
  ON propiedad_fotos FOR ALL
  TO authenticated
  USING (
    auth_is_superadmin()
    OR auth_user_role() IN ('gerente', 'admin')
  )
  WITH CHECK (
    auth_is_superadmin()
    OR auth_user_role() IN ('gerente', 'admin')
  );

-- ─── 5. VERIFICACIÓN ──────────────────────────────────────────────────────────

-- Confirmar columna nueva en propiedades
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'propiedades'
  AND column_name  = 'foto_principal_url';

-- Confirmar tabla y sus columnas
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'propiedad_fotos'
ORDER BY ordinal_position;

-- Confirmar políticas RLS
SELECT policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename  = 'propiedad_fotos'
ORDER BY policyname;
