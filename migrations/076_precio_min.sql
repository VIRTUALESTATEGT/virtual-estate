-- Migration 076: precio_min en propiedades (negociación interna — nunca expuesto al público)
ALTER TABLE propiedades ADD COLUMN IF NOT EXISTS precio_min NUMERIC;

-- Verificación
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'propiedades' AND column_name = 'precio_min';
