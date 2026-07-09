-- 049_fix_mkt_set_clip.sql
-- Corrige bug en mkt_set_clip: el operador (-> text) sobre un JSONB array devuelve
-- NULL en lugar del elemento, causando que NULL || p_patch = NULL y jsonb_set
-- escriba NULL en la columna clips, corrompiendo la fila.
-- Fix: usar (-> integer) para leer el elemento del array antes del merge.
-- Ejecutar manualmente en Supabase SQL Editor

CREATE OR REPLACE FUNCTION mkt_set_clip(
  p_contenido_id bigint,
  p_clip_idx     integer,
  p_patch        jsonb
) RETURNS contenido_generado AS $$
  UPDATE contenido_generado
  SET clips = jsonb_set(
    clips,
    ARRAY[p_clip_idx::text],
    (clips -> p_clip_idx) || p_patch,
    false
  )
  WHERE id = p_contenido_id
  RETURNING *;
$$ LANGUAGE sql;
