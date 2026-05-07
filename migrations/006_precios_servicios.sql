-- Migration 006: Editable service pricing table
-- Replaces hardcoded PRICING_FALLBACK in cotizacion-gen.js

CREATE TABLE IF NOT EXISTS precios_servicios (
  id              BIGSERIAL PRIMARY KEY,
  codigo          TEXT NOT NULL UNIQUE,
  nombre          TEXT NOT NULL,
  descripcion     TEXT DEFAULT '',
  precio_base     NUMERIC(10,2) DEFAULT 0,
  precio_por_m2   NUMERIC(10,4) DEFAULT 0,
  precio_minimo   NUMERIC(10,2) DEFAULT 0,
  moneda          TEXT DEFAULT 'USD',
  activo          BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Seed initial pricing from previous hardcoded values
INSERT INTO precios_servicios (codigo, nombre, descripcion, precio_base, precio_por_m2, precio_minimo) VALUES
  ('escaneo_3d',   'Escaneo 3D y Tour Virtual',       'Escaneo Matterport con tour virtual 360°',  150, 0.80, 150),
  ('as_built',     'AS BUILT / Documentación',         'Planos as-built y documentación técnica',   400, 1.20, 400),
  ('real_estate',  'Real Estate',                      'Fotografía y video para bienes raíces',     200, 0.50, 200),
  ('construccion', 'Construcción y Remodelación',      'Seguimiento y documentación de obra',       300, 0.90, 300)
ON CONFLICT (codigo) DO NOTHING;
