-- Migration 074: nuevos campos en propiedades
-- comision_ve, municipio, m2_construccion, m2_terreno,
-- precio_venta, precio_renta, impuestos_incluidos,
-- gastos_adicionales, gastos_adicionales_detalle

ALTER TABLE propiedades
  ADD COLUMN IF NOT EXISTS comision_ve                NUMERIC(4,1) DEFAULT 5,
  ADD COLUMN IF NOT EXISTS municipio                  VARCHAR(120),
  ADD COLUMN IF NOT EXISTS m2_construccion            NUMERIC,
  ADD COLUMN IF NOT EXISTS m2_terreno                 NUMERIC,
  ADD COLUMN IF NOT EXISTS precio_venta               NUMERIC,
  ADD COLUMN IF NOT EXISTS precio_renta               NUMERIC,
  ADD COLUMN IF NOT EXISTS impuestos_incluidos        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gastos_adicionales         NUMERIC,
  ADD COLUMN IF NOT EXISTS gastos_adicionales_detalle TEXT;

-- Backfill: modalidad es text[] desde migration 061
-- 'venta' = ANY(modalidad) cubre tanto ['venta'] como ['venta','renta']
UPDATE propiedades SET precio_venta = precio WHERE 'venta' = ANY(modalidad);
UPDATE propiedades SET precio_renta = precio WHERE 'renta' = ANY(modalidad);

-- Verificación
SELECT id, nombre, modalidad, precio,
       precio_venta, precio_renta, comision_ve, municipio
FROM propiedades
ORDER BY id
LIMIT 15;
