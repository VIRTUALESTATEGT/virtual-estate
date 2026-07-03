-- 040_logo_posicion.sql
-- Posición del logo por orden de contenido
-- Ejecutar manualmente en Supabase SQL Editor

alter table ordenes_contenido
  add column if not exists logo_posicion text default 'inferior-derecha';
