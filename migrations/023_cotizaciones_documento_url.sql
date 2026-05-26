-- Migration 023: add documento_url to cotizaciones (PDF stored at save time)
ALTER TABLE cotizaciones
  ADD COLUMN IF NOT EXISTS documento_url TEXT;
