-- Migration 019: extra cotizaciones columns for discount + property size

ALTER TABLE cotizaciones
  ADD COLUMN IF NOT EXISTS tamaño_propiedad_m2 INT,
  ADD COLUMN IF NOT EXISTS descuento_tipo  VARCHAR(20) DEFAULT 'porcentaje'
    CONSTRAINT cot_desc_tipo_check CHECK (descuento_tipo IN ('porcentaje','cantidad_fija')),
  ADD COLUMN IF NOT EXISTS descuento_valor NUMERIC(10,2) DEFAULT 0;
