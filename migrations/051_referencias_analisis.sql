-- Fase 8: análisis con visión en referencias + FK desde órdenes
ALTER TABLE referencias_publicidad
  ADD COLUMN IF NOT EXISTS analisis jsonb;

ALTER TABLE ordenes_contenido
  ADD COLUMN IF NOT EXISTS referencia_id bigint
    REFERENCES referencias_publicidad(id) ON DELETE SET NULL;
