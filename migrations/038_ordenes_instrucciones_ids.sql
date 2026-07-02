-- 038_ordenes_instrucciones_ids.sql
-- Agrega columna para guardar IDs de instrucciones individuales seleccionadas por orden
-- Ejecutar manualmente en Supabase SQL Editor

alter table ordenes_contenido
  add column if not exists instrucciones_ids jsonb default '[]'::jsonb;
