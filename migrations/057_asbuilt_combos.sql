-- Migration 057: combos AS-BUILT por caso de uso
-- Tres paquetes tipo 'paquete' sin descuento ni piso, reutilizando el motor de componentes.
-- Codes 5.1–5.3 reservados para As-Built.
--
-- 5.1 Remodelación: 3.1 DWG + 3.3 Cotas + 3.4 Muros/puertas/ventanas  (todos por_m2 — requiere m²)
-- 5.2 Levantamiento: 3.6 Gemelo 3D + 3.7 Medición remota + 3.11 Fotos 360°  (por_m2 + fijo — requiere m²)
-- 5.3 Avalúo/Trámite: 3.2 Planos PDF + 3.5 Anotaciones básicas  (todos por_m2 — requiere m²)

INSERT INTO precios_servicios
  (codigo, categoria, servicio, descripcion,
   tipo_precio, descuento_paquete_pct, cotizable_auto, activo, orden, componentes_ids)
SELECT
  '5.1',
  'As-Built',
  'As-Built Remodelación',
  'Planos DWG + Cotas + Muros/puertas/ventanas — para proyectos de remodelación u obra',
  'paquete', 0, true, true, 20,
  (SELECT jsonb_agg(id ORDER BY codigo)
     FROM precios_servicios
    WHERE codigo IN ('3.1','3.3','3.4') AND activo = true)
WHERE NOT EXISTS (SELECT 1 FROM precios_servicios WHERE codigo = '5.1');

INSERT INTO precios_servicios
  (codigo, categoria, servicio, descripcion,
   tipo_precio, descuento_paquete_pct, cotizable_auto, activo, orden, componentes_ids)
SELECT
  '5.2',
  'As-Built',
  'As-Built Levantamiento',
  'Gemelo 3D + Medición remota + Fotografías 360° — documentación técnica completa (requiere m²)',
  'paquete', 0, true, true, 21,
  (SELECT jsonb_agg(id ORDER BY codigo)
     FROM precios_servicios
    WHERE codigo IN ('3.6','3.7','3.11') AND activo = true)
WHERE NOT EXISTS (SELECT 1 FROM precios_servicios WHERE codigo = '5.2');

INSERT INTO precios_servicios
  (codigo, categoria, servicio, descripcion,
   tipo_precio, descuento_paquete_pct, cotizable_auto, activo, orden, componentes_ids)
SELECT
  '5.3',
  'As-Built',
  'As-Built Avalúo/Trámite',
  'Planos PDF + Anotaciones básicas — para avalúos y trámites administrativos',
  'paquete', 0, true, true, 22,
  (SELECT jsonb_agg(id ORDER BY codigo)
     FROM precios_servicios
    WHERE codigo IN ('3.2','3.5') AND activo = true)
WHERE NOT EXISTS (SELECT 1 FROM precios_servicios WHERE codigo = '5.3');

-- ── Verificación ──────────────────────────────────────────────────────────────
-- Esperado: 5.1 → 3 componentes, 5.2 → 3 componentes, 5.3 → 2 componentes

SELECT
  codigo,
  servicio,
  tipo_precio,
  descuento_paquete_pct,
  precio_minimo,
  cotizable_auto,
  jsonb_array_length(componentes_ids) AS n_componentes
FROM precios_servicios
WHERE codigo IN ('5.1','5.2','5.3')
ORDER BY codigo;
