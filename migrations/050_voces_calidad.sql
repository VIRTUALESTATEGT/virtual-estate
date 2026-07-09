-- 050_voces_calidad.sql
-- Fase 7.3: columnas de control de voces y calidad de video en órdenes.
-- Ejecutar manualmente en Supabase SQL Editor.

ALTER TABLE ordenes_contenido
  ADD COLUMN IF NOT EXISTS permitir_voces boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS video_calidad  text    DEFAULT 'fast';
