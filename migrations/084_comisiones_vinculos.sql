-- 084_comisiones_vinculos.sql
-- Amplía agentes, propiedades, clientes y cotizaciones para soportar el módulo de comisiones.
-- Idempotente: todos los ALTER usan ADD COLUMN IF NOT EXISTS / DROP CONSTRAINT IF EXISTS.
-- Requiere ejecutarse ANTES de 085_cierres_y_comisiones.sql.
-- Verificaciones en 084_verificacion.sql (correr por separado, después de este script).

BEGIN;

-- ─── 1. agentes: normalizar tipo + código propio + vínculo al portal ─────────
--
-- agentes.comision: el CRM la almacena como valor numérico (ej. 5 → "5%").
-- La tabla agentes es pre-migración; el tipo original no está documentado.
-- Este CAST preserva los valores existentes. Si falla, verificar con \d agentes en Supabase.
--
-- Un único % por agente aplica tanto a captación (pct_captador) como a cierre (pct_cierre).
-- Resolución de prioridad (documentada en 085):
--   override del cierre/cotización > propiedades.pct_cierre/monto_cierre_fijo > agentes.comision > comision_global_pct
--
-- Cuando agentes.comision es NULL en el momento de crear la comisión, el backend usa comision_global_pct.
-- No hay DEFAULT en la columna; el frontend (admin.html) pre-rellena con comision_global_pct al crear.

ALTER TABLE agentes
  ALTER COLUMN comision TYPE NUMERIC(5,2) USING comision::NUMERIC(5,2);

-- codigo: el mismo AGT-XXXX que hoy vive en solicitudes_agente.codigo_asignado y clientes.codigo_agente.
-- cliente_id: FK al clientes del portal de este agente (para leer banco, nombre, email canónico).
ALTER TABLE agentes
  ADD COLUMN IF NOT EXISTS codigo     TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS cliente_id BIGINT REFERENCES clientes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_agentes_cliente ON agentes(cliente_id);

-- ─── 2. propiedades: comisión de captación, comisión de cierre y estado ampliado ──

-- pct_captador : % de comisión para el agente que captó (listó) la propiedad.
-- pct_cierre   : % de comisión para el agente de cierre — valor predeterminado para esta propiedad.
-- monto_cierre_fijo + moneda_cierre_fijo: alternativa a pct_cierre en monto absoluto.
-- CHECK: pct_cierre y monto_cierre_fijo se excluyen mutuamente.
-- agente_responsable_id (ya existe en migración 077) sirve como captador — no se duplica.

ALTER TABLE propiedades
  ADD COLUMN IF NOT EXISTS pct_captador        NUMERIC(5,2)
    CHECK (pct_captador IS NULL OR (pct_captador > 0 AND pct_captador <= 100)),
  ADD COLUMN IF NOT EXISTS pct_cierre          NUMERIC(5,2)
    CHECK (pct_cierre IS NULL OR (pct_cierre > 0 AND pct_cierre <= 100)),
  ADD COLUMN IF NOT EXISTS monto_cierre_fijo   NUMERIC(12,2)
    CHECK (monto_cierre_fijo IS NULL OR monto_cierre_fijo > 0),
  ADD COLUMN IF NOT EXISTS moneda_cierre_fijo  TEXT
    CHECK (moneda_cierre_fijo IS NULL OR moneda_cierre_fijo IN ('GTQ','USD'));

ALTER TABLE propiedades
  ADD CONSTRAINT chk_propiedades_comision_cierre_exclusion CHECK (
    NOT (pct_cierre IS NOT NULL AND monto_cierre_fijo IS NOT NULL)
  );

-- Ampliar CHECK de estado_publicacion (auto-nombrado propiedades_estado_publicacion_check en migración 077).
ALTER TABLE propiedades
  DROP CONSTRAINT IF EXISTS propiedades_estado_publicacion_check;

ALTER TABLE propiedades
  ADD CONSTRAINT propiedades_estado_publicacion_check
    CHECK (estado_publicacion IN ('borrador','publicada','pausada','vendida','rentada'));

-- ─── 3. clientes: FK "referido por" ──────────────────────────────────────────
--
-- clientes.codigo_agente (TEXT ya existente): el código propio del cliente como agente de VE
--   (escrito al aprobar su solicitud en agente-solicitud.js:141). NO es "referido por".
-- referido_por_agente_id (nuevo): qué agente refirió a este cliente a VE.

ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS referido_por_agente_id BIGINT
    REFERENCES agentes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_clientes_referido_por ON clientes(referido_por_agente_id);

-- ─── 4. cotizaciones: vínculo a propiedad + % de agente ──────────────────────
--
-- propiedad_id : qué propiedad motivó el servicio cotizado.
-- pct_agente   : % acordado para el agente en esta cotización específica.
--                NULL → usar agentes.comision; si este también es NULL → comision_global_pct.

ALTER TABLE cotizaciones
  ADD COLUMN IF NOT EXISTS propiedad_id BIGINT
    REFERENCES propiedades(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pct_agente   NUMERIC(5,2)
    CHECK (pct_agente IS NULL OR (pct_agente > 0 AND pct_agente <= 100));

CREATE INDEX IF NOT EXISTS idx_cotizaciones_propiedad ON cotizaciones(propiedad_id);

COMMIT;
