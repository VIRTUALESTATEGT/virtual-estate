-- Migración 065: campos descriptivos en propiedades
--
-- Agrega 4 columnas que el formulario CRM ya capturaba pero descartaba silenciosamente.
-- Todas nullable: las propiedades existentes no tienen estos datos.

ALTER TABLE propiedades
  ADD COLUMN IF NOT EXISTS descripcion       TEXT,
  ADD COLUMN IF NOT EXISTS habitaciones      SMALLINT,
  ADD COLUMN IF NOT EXISTS banos             SMALLINT,
  ADD COLUMN IF NOT EXISTS anio_construccion SMALLINT;

-- Verificación
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'propiedades'
  AND column_name  IN ('descripcion','habitaciones','banos','anio_construccion')
ORDER BY column_name;
