-- 045_video_tipo_contenido.sql
-- Agrega tipo 'video' a ordenes_contenido y columnas de video en contenido_generado
-- Ejecutar manualmente en Supabase SQL Editor

-- Ampliar check constraint para aceptar 'video'
ALTER TABLE ordenes_contenido
  DROP CONSTRAINT IF EXISTS ordenes_contenido_tipo_contenido_check;
ALTER TABLE ordenes_contenido
  ADD CONSTRAINT ordenes_contenido_tipo_contenido_check
  CHECK (tipo_contenido IN ('imagen', 'texto', 'carrusel', 'video_slideshow', 'video'));

-- Duración deseada en la orden (4, 6 u 8 seg); reusamos formatos para el aspect ratio
ALTER TABLE ordenes_contenido
  ADD COLUMN IF NOT EXISTS duracion_seg integer DEFAULT 8;

-- Columnas de video en contenido generado
ALTER TABLE contenido_generado
  ADD COLUMN IF NOT EXISTS video_url       text,
  ADD COLUMN IF NOT EXISTS video_operation text,
  ADD COLUMN IF NOT EXISTS duracion_seg    integer;
