-- 084_verificacion.sql
-- Consultas de verificación para 084_comisiones_vinculos.sql.
-- Correr DESPUÉS de que 084 haya sido aplicado con éxito.
-- No modifica datos — solo lectura.

-- ─── PROPUESTA DE ENLACE agentes ↔ clientes por email ────────────────────────
-- Revisá el resultado antes de ejecutar el UPDATE correspondiente (no incluido aquí).

SELECT
  a.id               AS agente_id,
  a.nombre           AS agente_nombre,
  a.email            AS agente_email,
  a.codigo           AS codigo_en_agentes,
  c.id               AS cliente_id,
  c.email            AS cliente_email,
  c.codigo_agente    AS codigo_en_clientes,
  sa.codigo_asignado AS codigo_en_solicitudes
FROM agentes a
LEFT JOIN clientes c
       ON lower(trim(c.email)) = lower(trim(a.email))
LEFT JOIN solicitudes_agente sa
       ON sa.cliente_id = c.id AND sa.estado = 'aprobado'
ORDER BY a.id;

-- ─── VERIFICACIÓN DE COLUMNAS Y CONSTRAINTS ──────────────────────────────────

SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
       (table_name = 'agentes'       AND column_name IN ('comision','codigo','cliente_id'))
    OR (table_name = 'propiedades'   AND column_name IN ('pct_captador','pct_cierre','monto_cierre_fijo','moneda_cierre_fijo','estado_publicacion'))
    OR (table_name = 'clientes'      AND column_name = 'referido_por_agente_id')
    OR (table_name = 'cotizaciones'  AND column_name IN ('propiedad_id','pct_agente'))
  )
ORDER BY table_name, column_name;

SELECT conname, pg_get_constraintdef(oid) AS definicion
FROM pg_constraint
WHERE conrelid IN ('propiedades'::regclass)
  AND conname IN (
    'propiedades_estado_publicacion_check',
    'chk_propiedades_comision_cierre_exclusion'
  )
ORDER BY conname;
