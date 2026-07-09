-- 048_guion_clips.sql
-- Persiste el guión multi-clip de la orden para poder reanudar tras un reload.
-- Ejecutar manualmente en Supabase SQL Editor

ALTER TABLE ordenes_contenido
  ADD COLUMN IF NOT EXISTS guion_clips jsonb DEFAULT NULL;
