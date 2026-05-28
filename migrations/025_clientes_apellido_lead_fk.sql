-- Migration 025: add apellido to clientes + change lead FKs to ON DELETE SET NULL

-- 1. apellido column on clientes
ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS apellido VARCHAR(100);

-- 2. Change clientes.lead_id FK → ON DELETE SET NULL
--    (allows deleting a lead without violating the FK)
ALTER TABLE clientes
  DROP CONSTRAINT IF EXISTS clientes_lead_id_fkey;
ALTER TABLE clientes
  ADD CONSTRAINT clientes_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL;

-- 3. Change cotizaciones.lead_id FK → ON DELETE SET NULL
ALTER TABLE cotizaciones
  DROP CONSTRAINT IF EXISTS cotizaciones_lead_id_fkey;
ALTER TABLE cotizaciones
  ADD CONSTRAINT cotizaciones_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL;
