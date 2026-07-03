-- 041_logo_tamano.sql
-- Tamaño del logo configurable por orden
-- Ejecutar manualmente en Supabase SQL Editor

alter table ordenes_contenido
  add column if not exists logo_tamano text default 'mediano';
