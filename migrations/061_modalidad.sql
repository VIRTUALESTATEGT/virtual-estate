-- Migration 061: convert modalidad text → text[]
-- Run immediately after Vercel confirms Deploy 2 is "Ready"

ALTER TABLE propiedades ADD COLUMN IF NOT EXISTS modalidad_arr text[] NOT NULL DEFAULT '{}';

UPDATE propiedades SET modalidad_arr =
  CASE
    WHEN LOWER(modalidad::text) LIKE '%venta%' AND LOWER(modalidad::text) LIKE '%renta%' THEN ARRAY['venta','renta']
    WHEN LOWER(modalidad::text) LIKE '%venta%' THEN ARRAY['venta']
    WHEN LOWER(modalidad::text) LIKE '%renta%' THEN ARRAY['renta']
    ELSE '{}'
  END;

ALTER TABLE propiedades DROP COLUMN modalidad;
ALTER TABLE propiedades RENAME COLUMN modalidad_arr TO modalidad;

CREATE INDEX IF NOT EXISTS idx_propiedades_modalidad ON propiedades USING gin(modalidad);

-- Verification
SELECT column_name, data_type, column_default, is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'propiedades'
    AND column_name = 'modalidad';

SELECT id, nombre, modalidad FROM propiedades ORDER BY id;
