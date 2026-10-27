-- 082_video_iniciado_en.sql
-- Agrega video_iniciado_en para trackear el momento exacto en que se llama a iniciarVideo.
-- Se actualiza en cada llamada (insert inicial y regenerar), no solo al crear la fila.
-- Las filas existentes quedan NULL intencionalmente: el timeout no aplica a clips viejos.
ALTER TABLE contenido_generado
  ADD COLUMN IF NOT EXISTS video_iniciado_en TIMESTAMPTZ;
