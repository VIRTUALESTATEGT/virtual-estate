-- Migration 020: fix canal constraint + add moneda/tasa to precios_servicios

-- A. Expand cotizaciones canal constraint to include 'crm' and 'email'
ALTER TABLE cotizaciones
  DROP CONSTRAINT IF EXISTS cotizaciones_canal_check;

ALTER TABLE cotizaciones
  ADD CONSTRAINT cotizaciones_canal_check
  CHECK (canal IN ('whatsapp','instagram','facebook','web','email','crm'));

-- B. Add moneda and tasa_conversion to precios_servicios
ALTER TABLE precios_servicios
  ADD COLUMN IF NOT EXISTS moneda         VARCHAR(3)    DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS tasa_conversion NUMERIC(7,4) DEFAULT 7.9000;
