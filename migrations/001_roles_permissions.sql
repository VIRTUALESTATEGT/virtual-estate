-- ╔══════════════════════════════════════════════════════════╗
-- ║  Virtual Estate — Migration 001: Roles & Permissions     ║
-- ║  Ejecutar en Supabase → SQL Editor                       ║
-- ╚══════════════════════════════════════════════════════════╝

-- 1. Extender tabla usuarios
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'asistente'
    CHECK (role IN ('superadmin','admin','coordinador','agente','asistente')),
  ADD COLUMN IF NOT EXISTS is_superadmin BOOLEAN NOT NULL DEFAULT FALSE;

-- Marcar primer usuario como superadmin (ajusta el id si es necesario)
-- UPDATE usuarios SET is_superadmin = TRUE, role = 'superadmin' WHERE id = 1;

-- 2. Tabla permisos_usuario
CREATE TABLE IF NOT EXISTS permisos_usuario (
  id          BIGSERIAL PRIMARY KEY,
  usuario_id  BIGINT    NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  permiso     TEXT      NOT NULL,
  valor       BOOLEAN   NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (usuario_id, permiso)
);

-- 3. Tabla propiedades_adicionales
CREATE TABLE IF NOT EXISTS propiedades_adicionales (
  id            BIGSERIAL PRIMARY KEY,
  propiedad_id  BIGINT NOT NULL REFERENCES propiedades(id) ON DELETE CASCADE,
  tipo          TEXT   NOT NULL
    CHECK (tipo IN ('servicios_basicos','espacios_ambientes','adicionales','amenidades')),
  nombre        TEXT   NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Tabla propiedades_favoritas
CREATE TABLE IF NOT EXISTS propiedades_favoritas (
  id            BIGSERIAL PRIMARY KEY,
  cliente_id    BIGINT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  propiedad_id  BIGINT NOT NULL REFERENCES propiedades(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (cliente_id, propiedad_id)
);
