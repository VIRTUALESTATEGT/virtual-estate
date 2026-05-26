-- Migration 024: add apellido column to leads
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS apellido VARCHAR(100);
