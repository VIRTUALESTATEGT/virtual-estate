-- 039_formatos_overlay.sql
-- Formatos múltiples por orden + columnas de overlay en contenido generado
-- Ejecutar manualmente en Supabase SQL Editor

alter table ordenes_contenido
  add column if not exists formatos jsonb default '["1:1"]'::jsonb;

alter table contenido_generado
  add column if not exists formato               text default '1:1',
  add column if not exists imagen_original_url   text;
