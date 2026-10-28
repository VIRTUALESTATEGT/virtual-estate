-- 083_ordenes_permitir_cortes.sql
-- Guarda si el usuario quiere permitir cortes de escena en la generación de video.
-- Mismo patrón que permitir_voces. Default false = toma continua (comportamiento actual).
ALTER TABLE ordenes_contenido
  ADD COLUMN IF NOT EXISTS permitir_cortes BOOLEAN DEFAULT false;
