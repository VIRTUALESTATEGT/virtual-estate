-- 081_propiedades_campos_comerciales.sql
-- Fix tipo de banos a NUMERIC(3,1) para soportar medios baños (1.5, 2.5, etc.)
-- Agrega 4 campos comerciales: mantenimiento, arras y estado hipotecario.

-- Fix banos: SMALLINT → NUMERIC(3,1)
ALTER TABLE propiedades ALTER COLUMN banos TYPE NUMERIC(3,1);

-- Campos comerciales nuevos
ALTER TABLE propiedades
  ADD COLUMN IF NOT EXISTS mantenimiento        NUMERIC,
  ADD COLUMN IF NOT EXISTS arras_porcentaje     NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS arras_penitenciarias BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS hipotecada           BOOLEAN DEFAULT false;

-- Verificación
SELECT column_name, data_type, numeric_precision, numeric_scale
FROM information_schema.columns
WHERE table_name = 'propiedades'
  AND column_name IN ('banos','mantenimiento','arras_porcentaje','arras_penitenciarias','hipotecada')
ORDER BY column_name;
