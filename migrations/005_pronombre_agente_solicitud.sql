-- Migration 005: pronombre on clientes, codigo_agente, solicitudes_agente table

-- 1. Add pronombre to clientes (masculino / femenino / neutro)
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS pronombre TEXT DEFAULT 'masculino';

-- 2. Add codigo_agente to clientes (set when admin approves agent request)
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS codigo_agente TEXT DEFAULT NULL;

-- 3. Create solicitudes_agente table
CREATE TABLE IF NOT EXISTS solicitudes_agente (
  id               BIGSERIAL PRIMARY KEY,
  cliente_id       BIGINT REFERENCES clientes(id) ON DELETE SET NULL,
  nombre           TEXT NOT NULL,
  email            TEXT NOT NULL,
  banco            TEXT,
  tipo_cuenta      TEXT,
  cuenta_bancaria  TEXT,
  titular_cuenta   TEXT,
  tipo_referido    TEXT,
  notas            TEXT,
  dpi_frente       TEXT,   -- base64 data URL
  dpi_reverso      TEXT,   -- base64 data URL (optional)
  selfie           TEXT,   -- base64 data URL
  acepta_terminos  BOOLEAN DEFAULT FALSE,
  firma_electronica TEXT,  -- typed full name as e-signature
  ip_registro      TEXT,
  estado           TEXT DEFAULT 'pendiente', -- pendiente | aprobado | rechazado
  codigo_asignado  TEXT DEFAULT NULL,        -- AGT-YY-XXXXX (set on approval)
  notas_admin      TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Index for fast lookup by cliente_id and estado
CREATE INDEX IF NOT EXISTS idx_solicitudes_agente_cliente ON solicitudes_agente(cliente_id);
CREATE INDEX IF NOT EXISTS idx_solicitudes_agente_estado  ON solicitudes_agente(estado);

-- 5. RLS: clients can only read their own solicitud (by client_id)
ALTER TABLE solicitudes_agente ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS — no policy needed for backend.
-- Only need policies if we ever use anon key from frontend (we don't).
