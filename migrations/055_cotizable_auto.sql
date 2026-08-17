-- Migration 055: add cotizable_auto flag to precios_servicios
-- Lets the AI agent know which services it can quote automatically.
-- Admin controls this per-row from the Precios UI — no code change needed
-- when adding new services.

ALTER TABLE precios_servicios
  ADD COLUMN IF NOT EXISTS cotizable_auto BOOLEAN DEFAULT false;

UPDATE precios_servicios
  SET cotizable_auto = true
  WHERE categoria IN ('Tours Virtuales', 'Paquetes Inmobiliarios');
