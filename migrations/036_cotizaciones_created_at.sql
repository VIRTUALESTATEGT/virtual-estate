-- Migration 036: add created_at to cotizaciones for age-based cron cleanup
-- Fixes /api/cron/limpiar Tarea 1 which failed with "column cotizaciones.created_at does not exist".

ALTER TABLE cotizaciones
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- Backfill historical rows: best proxy for confirmed rows is fecha_confirmacion,
-- for sent-only rows fecha_envio_manual, otherwise mark as NOW() (safe — they
-- won't be deleted until 3 months after this migration runs).
UPDATE cotizaciones
SET created_at = COALESCE(fecha_confirmacion, fecha_envio_manual, NOW())
WHERE created_at IS NULL;
