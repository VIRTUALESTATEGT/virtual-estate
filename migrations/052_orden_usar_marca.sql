-- Fase 8.1b: columna usar_marca en órdenes para bifurcar contexto de marca y overlay
ALTER TABLE ordenes_contenido
  ADD COLUMN IF NOT EXISTS usar_marca boolean DEFAULT true;
