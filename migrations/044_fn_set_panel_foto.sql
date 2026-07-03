-- 044_fn_set_panel_foto.sql
-- Actualiza atomicamente paneles[idx].imagen_url en contenido_generado
-- usando jsonb_set para evitar la race condition de read-modify-write en Node.
-- Ejecutar manualmente en Supabase SQL Editor

CREATE OR REPLACE FUNCTION mkt_set_panel_foto(
  p_contenido_id bigint,
  p_panel_idx    integer,
  p_url          text
) RETURNS contenido_generado AS $$
  UPDATE contenido_generado
  SET paneles = jsonb_set(
    paneles,
    ARRAY[p_panel_idx::text, 'imagen_url'],
    to_jsonb(p_url),
    false
  )
  WHERE id = p_contenido_id
  RETURNING *;
$$ LANGUAGE sql;
