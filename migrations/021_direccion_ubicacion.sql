-- Migration 021: add address fields to clientes + ubicacion to cotizaciones + audit expansion

-- A. Address fields on clientes
ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS direccion TEXT,
  ADD COLUMN IF NOT EXISTS zona      VARCHAR(50),
  ADD COLUMN IF NOT EXISTS ciudad    VARCHAR(50);

-- B. Job-site location on cotizaciones (separate from client address)
ALTER TABLE cotizaciones
  ADD COLUMN IF NOT EXISTS ubicacion_calle   TEXT,
  ADD COLUMN IF NOT EXISTS ubicacion_zona    VARCHAR(50),
  ADD COLUMN IF NOT EXISTS ubicacion_ciudad  VARCHAR(50),
  ADD COLUMN IF NOT EXISTS ubicacion_completa TEXT;

-- C. Richer audit trail on confirmaciones_registro
ALTER TABLE confirmaciones_registro
  ADD COLUMN IF NOT EXISTS servicios_json        JSONB,
  ADD COLUMN IF NOT EXISTS tamano_propiedad_m2   INT,
  ADD COLUMN IF NOT EXISTS zona                  TEXT,
  ADD COLUMN IF NOT EXISTS ubicacion_completa    TEXT,
  ADD COLUMN IF NOT EXISTS user_agent            TEXT,
  ADD COLUMN IF NOT EXISTS fecha_confirmacion    TIMESTAMPTZ DEFAULT NOW();
