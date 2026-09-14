-- 071_propiedades_moneda.sql
-- Agrega campo moneda a propiedades y tasa de cambio editable en config_sitio.

ALTER TABLE propiedades
  ADD COLUMN IF NOT EXISTS moneda TEXT NOT NULL DEFAULT 'USD'
  CHECK (moneda IN ('USD', 'GTQ'));

INSERT INTO config_sitio (clave, valor)
VALUES ('tasa_cambio_usd_gtq', '7.90')
ON CONFLICT (clave) DO NOTHING;
