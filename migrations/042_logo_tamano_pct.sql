-- 042_logo_tamano_pct.sql
-- Porcentaje libre para el tamaño del logo (5-40, default 15)
-- Mantiene logo_tamano para compatibilidad con órdenes anteriores
-- Ejecutar manualmente en Supabase SQL Editor

alter table ordenes_contenido
  add column if not exists logo_tamano_pct integer default 15;
