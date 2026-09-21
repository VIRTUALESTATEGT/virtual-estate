-- 077_campos_propiedades.sql
-- Campos adicionales en tabla propiedades: dirección, video, estado de publicación,
-- agente responsable y notas internas.

ALTER TABLE propiedades
  ADD COLUMN IF NOT EXISTS direccion              TEXT,
  ADD COLUMN IF NOT EXISTS video_url              TEXT,
  ADD COLUMN IF NOT EXISTS estado_publicacion     TEXT NOT NULL DEFAULT 'borrador'
                              CHECK (estado_publicacion IN ('borrador','publicada','pausada')),
  ADD COLUMN IF NOT EXISTS agente_responsable_id  INTEGER REFERENCES agentes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS notas_internas         TEXT;
