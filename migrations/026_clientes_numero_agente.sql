-- Migration 026: add numero_agente to clientes
ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS numero_agente VARCHAR(20);
