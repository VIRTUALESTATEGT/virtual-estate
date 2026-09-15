-- Migración 072: parqueos en propiedades
--
-- Agrega la columna parqueos. Nullable: las propiedades existentes
-- no tienen este dato; el filtro "1+" las excluirá correctamente
-- porque NULL >= N evalúa como NULL en PostgreSQL (no como TRUE).

ALTER TABLE propiedades
  ADD COLUMN IF NOT EXISTS parqueos SMALLINT;

-- Estado actual: cuántas propiedades tienen cada campo de specs lleno
SELECT
  COUNT(*)                                          AS total,
  COUNT(*) FILTER (WHERE habitaciones IS NOT NULL)  AS con_habitaciones,
  COUNT(*) FILTER (WHERE banos        IS NOT NULL)  AS con_banos,
  COUNT(*) FILTER (WHERE parqueos     IS NOT NULL)  AS con_parqueos
FROM propiedades;
