-- 085_cierres_y_comisiones.sql
-- Tabla cierres_propiedad + ampliación de comisiones para múltiples tipos.
-- Requiere 084_comisiones_vinculos.sql aplicado primero.
--
-- ─── BASE DE CÁLCULO (constante de negocio, NO hardcodeada en SQL) ────────────
--
--   VENTA:
--     comision_ve_cobrada = precio_final × propiedades.comision_ve / 100
--     (editable al registrar el cierre; propiedades.comision_ve DEFAULT 5)
--
--   RENTA:
--     comision_ve_cobrada = precio_final × 1  (= primer mes completo de renta)
--     (editable al registrar el cierre)
--
--   Comisión del agente sobre comision_ve_cobrada:
--     modo 'porcentaje' → monto_comision = ROUND(comision_ve_cobrada × pct_comision / 100, 2)
--     modo 'monto_fijo' → monto_comision = monto_fijo acordado (en moneda del cierre)
--
-- ─── REGLA DE RESOLUCIÓN DEL % (backend la aplica al crear la comisión) ───────
--
--   Prioridad decreciente:
--     1. pct_agente en cotizacion (cotizaciones.pct_agente) — override de cotización
--        ó pct_cierre_override / monto_cierre_fijo_override en el cierre puntual
--     2. propiedades.pct_cierre ó propiedades.monto_cierre_fijo — default de propiedad
--     3. agentes.comision — % personal del agente
--     4. comision_global_pct (config_sitio) — tasa global de fallback
--
--   El valor elegido se congela en comisiones.pct_comision + comisiones.monto_comision
--   al momento de insertar la fila (snapshot inmutable).
--   comisiones.origen_pct registra de qué nivel vino el valor ('cierre'|'propiedad'|'agente'|'global'|'cotizacion').

BEGIN;

-- ─── GUARD: confirmar estado de comisiones antes de ALTERs destructivos ──────
SELECT COUNT(*) AS filas_comisiones_antes FROM comisiones;

-- ─── 1. Tabla cierres_propiedad ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cierres_propiedad (
  id                         BIGSERIAL PRIMARY KEY,

  propiedad_id               BIGINT NOT NULL REFERENCES propiedades(id) ON DELETE RESTRICT,
  tipo                       TEXT   NOT NULL CHECK (tipo IN ('venta', 'renta')),

  precio_final               NUMERIC(14,2) NOT NULL CHECK (precio_final > 0),
  moneda                     TEXT   NOT NULL DEFAULT 'USD' CHECK (moneda IN ('GTQ','USD')),
  fecha_cierre               DATE   NOT NULL,

  -- Agente que gestionó el cierre (puede diferir del agente_responsable/captador)
  agente_cierre_id           BIGINT REFERENCES agentes(id) ON DELETE SET NULL,

  -- Override puntual: si se especifica, toma prioridad sobre propiedades.pct_cierre / monto_cierre_fijo.
  -- pct y monto_fijo se excluyen mutuamente (mismo patrón que propiedades).
  pct_cierre_override        NUMERIC(5,2)
    CHECK (pct_cierre_override IS NULL OR (pct_cierre_override > 0 AND pct_cierre_override <= 100)),
  monto_cierre_fijo_override NUMERIC(12,2)
    CHECK (monto_cierre_fijo_override IS NULL OR monto_cierre_fijo_override > 0),
  moneda_cierre_fijo_override TEXT
    CHECK (moneda_cierre_fijo_override IS NULL OR moneda_cierre_fijo_override IN ('GTQ','USD')),

  -- Comisión que VE efectivamente cobró al cliente (base de cálculo para agentes).
  -- Editable al registrar el cierre; ver constante de negocio arriba.
  comision_ve_cobrada        NUMERIC(12,2) CHECK (comision_ve_cobrada IS NULL OR comision_ve_cobrada >= 0),
  cobro_ve_confirmado        BOOLEAN NOT NULL DEFAULT FALSE,
  fecha_cobro                DATE,

  notas                      TEXT,
  created_at                 TIMESTAMPTZ DEFAULT NOW(),

  -- Override puntual: pct y monto_fijo se excluyen mutuamente
  CONSTRAINT chk_cierres_override_exclusion CHECK (
    NOT (pct_cierre_override IS NOT NULL AND monto_cierre_fijo_override IS NOT NULL)
  ),

  -- Si cobro confirmado, fecha obligatoria; y viceversa
  CONSTRAINT chk_cobro_completo CHECK (
    (cobro_ve_confirmado = FALSE AND fecha_cobro IS NULL)
    OR
    (cobro_ve_confirmado = TRUE  AND fecha_cobro IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_cierres_propiedad_id  ON cierres_propiedad(propiedad_id);
CREATE INDEX IF NOT EXISTS idx_cierres_agente_id     ON cierres_propiedad(agente_cierre_id);
CREATE INDEX IF NOT EXISTS idx_cierres_fecha_cierre  ON cierres_propiedad(fecha_cierre);

ALTER TABLE cierres_propiedad ENABLE ROW LEVEL SECURITY;
-- Backend usa service role (bypassa RLS). Sin políticas anon — mismo patrón que comisiones.

-- ─── 2. Ampliación de comisiones ──────────────────────────────────────────────

-- 2a. cotizacion_id pasa a nullable (solo exigida para tipos que la requieren)
ALTER TABLE comisiones
  ALTER COLUMN cotizacion_id DROP NOT NULL;

-- 2b. Convertir monto_comision de GENERATED STORED a columna normal.
--     Requiere PostgreSQL ≥ 14 (Supabase Cloud usa PG 15 en proyectos desde 2023+).
--     Los valores actuales calculados se preservan como datos inmutables.
--     A partir de aquí el backend calcula y escribe monto_comision explícitamente.
--
--     chk_pago_completo original (sin cambios, no referencia monto_comision):
--       (pagada_at IS NULL AND metodo_pago IS NULL AND referencia_pago IS NULL AND pagada_por IS NULL)
--       OR
--       (pagada_at IS NOT NULL AND metodo_pago IS NOT NULL AND referencia_pago IS NOT NULL AND pagada_por IS NOT NULL)
--
--     chk_reversion_completa original (sin cambios):
--       (revertida_at IS NULL AND nota_reversion IS NULL AND revertida_por IS NULL)
--       OR
--       (revertida_at IS NOT NULL AND nota_reversion IS NOT NULL AND revertida_por IS NOT NULL)
ALTER TABLE comisiones
  ALTER COLUMN monto_comision DROP EXPRESSION;

-- 2c. pct_comision y subtotal_sin_iva pasan a nullable.
--     pct_comision: en modo monto_fijo no aplica.
--     subtotal_sin_iva: era NOT NULL en migración 059; no existe para comisiones de cierre sin cotización.
ALTER TABLE comisiones
  ALTER COLUMN pct_comision     DROP NOT NULL;

ALTER TABLE comisiones
  ALTER COLUMN subtotal_sin_iva DROP NOT NULL;

ALTER TABLE comisiones
  DROP CONSTRAINT IF EXISTS comisiones_pct_comision_check;

-- 2d. Ampliar CHECK de estado: agrega 'por_pagar' entre pendiente y pagada.
--     Flujo completo: no_validada → pendiente → por_pagar → pagada  /  rechazada
--     (auto-nombrado comisiones_estado_check en migración 059)
ALTER TABLE comisiones
  DROP CONSTRAINT IF EXISTS comisiones_estado_check;

ALTER TABLE comisiones
  ADD CONSTRAINT comisiones_estado_check
    CHECK (estado IN ('no_validada', 'pendiente', 'por_pagar', 'pagada', 'rechazada'));

-- 2e. Nuevas columnas
ALTER TABLE comisiones
  ADD COLUMN IF NOT EXISTS tipo         TEXT,
  ADD COLUMN IF NOT EXISTS propiedad_id BIGINT REFERENCES propiedades(id)       ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cierre_id    BIGINT REFERENCES cierres_propiedad(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS moneda       TEXT DEFAULT 'USD' CHECK (moneda IN ('GTQ','USD')),
  -- modo: cómo se calculó monto_comision
  ADD COLUMN IF NOT EXISTS modo         TEXT CHECK (modo IN ('porcentaje','monto_fijo')),
  -- origen_pct: de qué nivel de la cascada vino el valor (para auditoría)
  ADD COLUMN IF NOT EXISTS origen_pct   TEXT
    CHECK (origen_pct IN ('cierre','propiedad','agente','global','cotizacion'));

-- 2f. CHECK de modo: pct_comision requerido para porcentaje; monto_comision para fijo.
--     NULL en ambos = fila legacy sin modo asignado (no se restringe).
ALTER TABLE comisiones
  ADD CONSTRAINT chk_comision_modo CHECK (
    modo IS NULL
    OR (modo = 'porcentaje' AND pct_comision   IS NOT NULL AND pct_comision   > 0 AND pct_comision   <= 100)
    OR (modo = 'monto_fijo' AND monto_comision IS NOT NULL AND monto_comision > 0)
  );

-- 2g. Eliminar UNIQUE global (agente_id, cotizacion_id) de forma robusta.
--     El nombre auto-asignado en migración 059 puede variar entre entornos;
--     se busca por tipo 'u' y definición en lugar de nombre hardcodeado.
DO $$
DECLARE _c TEXT;
BEGIN
  SELECT conname INTO _c
  FROM pg_constraint
  WHERE conrelid = 'comisiones'::regclass
    AND contype  = 'u'
    AND pg_get_constraintdef(oid) LIKE '%(agente_id, cotizacion_id)%';
  IF _c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE comisiones DROP CONSTRAINT %I', _c);
  END IF;
END $$;

-- Un agente no puede reclamar la misma cotización como referida dos veces
CREATE UNIQUE INDEX IF NOT EXISTS uq_comision_cotizacion_referida
  ON comisiones(agente_id, cotizacion_id)
  WHERE tipo = 'cotizacion_referida';

-- Un agente no puede reclamar captación dos veces por la misma cotización
-- (captacion_escaneo se ancla a cotizacion_id + propiedad_id, NO a cierre_id)
CREATE UNIQUE INDEX IF NOT EXISTS uq_comision_captacion_escaneo
  ON comisiones(agente_id, cotizacion_id)
  WHERE tipo = 'captacion_escaneo';

-- Un agente no puede reclamar cierre dos veces para el mismo cierre
CREATE UNIQUE INDEX IF NOT EXISTS uq_comision_cierre_propiedad
  ON comisiones(agente_id, cierre_id)
  WHERE tipo = 'cierre_propiedad';

-- 2h. CHECK de ancla: cada tipo exige sus FKs correspondientes.
--     captacion_escaneo ancla a cotizacion_id + propiedad_id (NO cierre_id).
--     tipo NULL = filas legacy sin tipo (no se restringe para compatibilidad).
ALTER TABLE comisiones
  ADD CONSTRAINT chk_ancla_tipo CHECK (
    tipo IS NULL
    OR (tipo = 'cotizacion_referida' AND cotizacion_id IS NOT NULL)
    OR (tipo = 'captacion_escaneo'   AND cotizacion_id IS NOT NULL AND propiedad_id IS NOT NULL)
    OR (tipo = 'cierre_propiedad'    AND cierre_id IS NOT NULL)
  );

-- 2i. Índices nuevos
CREATE INDEX IF NOT EXISTS idx_comisiones_cierre      ON comisiones(cierre_id);
CREATE INDEX IF NOT EXISTS idx_comisiones_tipo        ON comisiones(tipo);
CREATE INDEX IF NOT EXISTS idx_comisiones_propiedad   ON comisiones(propiedad_id);

-- ─── 3. Vista v_cierres_con_comision ─────────────────────────────────────────

CREATE OR REPLACE VIEW v_cierres_con_comision AS
SELECT
  cp.id                                                                        AS cierre_id,
  cp.tipo,
  cp.fecha_cierre,
  cp.precio_final,
  cp.moneda,
  cp.pct_cierre_override,
  cp.monto_cierre_fijo_override,
  cp.moneda_cierre_fijo_override,
  cp.comision_ve_cobrada,
  cp.cobro_ve_confirmado,
  cp.fecha_cobro,
  cp.notas,
  cp.created_at,
  -- Propiedad
  p.id                                                                         AS propiedad_id,
  p.direccion                                                                  AS propiedad_direccion,
  p.estado_publicacion,
  p.comision_ve                                                                AS comision_ve_pct,
  -- Agente de cierre
  a.id                                                                         AS agente_cierre_id,
  a.nombre                                                                     AS agente_cierre_nombre,
  -- Resumen de comisiones vinculadas al cierre
  COUNT(c.id)                                                                  AS total_comisiones,
  SUM(c.monto_comision) FILTER (WHERE c.estado <> 'rechazada')                AS monto_total_comisiones,
  SUM(c.monto_comision) FILTER (WHERE c.estado = 'pagada')                    AS monto_pagado,
  SUM(c.monto_comision) FILTER (WHERE c.estado IN ('pendiente','por_pagar'))  AS monto_pendiente
FROM      cierres_propiedad cp
JOIN      propiedades p ON p.id = cp.propiedad_id
LEFT JOIN agentes     a ON a.id = cp.agente_cierre_id
LEFT JOIN comisiones  c ON c.cierre_id = cp.id
GROUP BY  cp.id, p.id, p.direccion, p.estado_publicacion, p.comision_ve, a.id, a.nombre;

ALTER VIEW v_cierres_con_comision SET (security_invoker = true);
REVOKE ALL ON v_cierres_con_comision FROM anon, authenticated;

COMMIT;

-- ─── VERIFICACIÓN FINAL (fuera de la transacción) ────────────────────────────

-- Estructura de cierres_propiedad
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'cierres_propiedad'
ORDER BY ordinal_position;

-- Todos los constraints de comisiones (verifica DROP EXPRESSION, CHECKs nuevos, UNIQUE eliminado)
SELECT conname, contype, pg_get_constraintdef(oid) AS definicion
FROM pg_constraint
WHERE conrelid = 'comisiones'::regclass
ORDER BY contype, conname;

-- Índices en comisiones (incluye los parciales nuevos)
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'comisiones'
ORDER BY indexname;

-- Confirmar que monto_comision ya no es GENERATED
SELECT column_name, is_generated, generation_expression
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'comisiones'
  AND column_name  = 'monto_comision';

-- Columnas modificadas en comisiones
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'comisiones'
  AND column_name IN ('tipo','propiedad_id','cierre_id','moneda','modo','origen_pct',
                      'pct_comision','monto_comision','subtotal_sin_iva')
ORDER BY column_name;

-- Constraints de cierres_propiedad
SELECT conname, pg_get_constraintdef(oid) AS definicion
FROM pg_constraint
WHERE conrelid = 'cierres_propiedad'::regclass
ORDER BY conname;

-- Filas finales (debería ser 0 si tabla estaba vacía)
SELECT COUNT(*) AS filas_comisiones_despues FROM comisiones;
