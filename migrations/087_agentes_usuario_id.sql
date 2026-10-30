-- Migration 087: agentes.usuario_id — FK directa a usuarios para autenticación del portal.
-- Permite que el portal identifique al agente por req.usuario.id sin pasar por clientes.email.
-- El índice único parcial garantiza que una cuenta no pueda ser agente de dos agentes distintos.

BEGIN;

ALTER TABLE agentes
  ADD COLUMN IF NOT EXISTS usuario_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL;

-- Único solo donde no sea null: permite agentes sin cuenta de portal (usuario_id IS NULL).
CREATE UNIQUE INDEX IF NOT EXISTS uq_agentes_usuario_id
  ON agentes(usuario_id)
  WHERE usuario_id IS NOT NULL;

COMMIT;

-- Verificación
SELECT column_name, data_type, is_nullable
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name   = 'agentes'
  AND  column_name  = 'usuario_id';

SELECT indexname, indexdef
FROM   pg_indexes
WHERE  tablename = 'agentes' AND indexname = 'uq_agentes_usuario_id';
