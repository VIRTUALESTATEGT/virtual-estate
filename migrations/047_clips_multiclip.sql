-- 047_clips_multiclip.sql
-- Soporte para video multi-clip encadenado (Fase 7.2)
-- Ejecutar manualmente en Supabase SQL Editor

ALTER TABLE contenido_generado
  ADD COLUMN IF NOT EXISTS clips           jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS video_final_url text;

-- Actualiza campos arbitrarios de clips[idx] de forma atómica.
-- p_patch es un objeto jsonb que se fusiona (||) sobre el clip existente.
-- Ejemplo: mkt_set_clip(42, 1, '{"operation":"models/...","estado":"generando"}')
CREATE OR REPLACE FUNCTION mkt_set_clip(
  p_contenido_id bigint,
  p_clip_idx     integer,
  p_patch        jsonb
) RETURNS contenido_generado AS $$
  UPDATE contenido_generado
  SET clips = jsonb_set(
    clips,
    ARRAY[p_clip_idx::text],
    (clips -> p_clip_idx::text) || p_patch,
    false
  )
  WHERE id = p_contenido_id
  RETURNING *;
$$ LANGUAGE sql;
