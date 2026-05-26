-- Migration 022: add missing columns to leads table

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS fuente      VARCHAR(50)  DEFAULT 'Otro',
  ADD COLUMN IF NOT EXISTS servicio    VARCHAR(100),
  ADD COLUMN IF NOT EXISTS presupuesto VARCHAR(100),
  ADD COLUMN IF NOT EXISTS seguimiento TEXT;
