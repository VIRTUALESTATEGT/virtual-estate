-- Migration 056: catálogo de servicios individuales + estructura de paquetes calculados
-- Paquetes pasan de precio fijo a: Σ(componentes por m²) × (1 − descuento) ≥ piso
-- Tour virtual: los 3 tramos (1.1, 1.2, 1.3) van en componentes_ids;
-- el motor elige el correcto por rango de m² en tiempo de cálculo.

-- ── A. Columnas nuevas ──────────────────────────────────────────────────────────

ALTER TABLE precios_servicios
  ADD COLUMN IF NOT EXISTS componentes_ids       JSONB        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS descuento_paquete_pct NUMERIC(5,2) DEFAULT 0;

-- Ampliar CHECK de tipo_precio para aceptar 'paquete'
-- (si el DROP falla por nombre distinto, verificar con:
--  SELECT conname FROM pg_constraint WHERE conrelid='precios_servicios'::regclass AND contype='c')
ALTER TABLE precios_servicios
  DROP CONSTRAINT IF EXISTS precios_servicios_tipo_precio_check;

ALTER TABLE precios_servicios
  ADD CONSTRAINT precios_servicios_tipo_precio_check
    CHECK (tipo_precio IN ('fijo','por_m2','rango_m2','cotizar','paquete'));

-- ── B. Actualizar filas existentes ─────────────────────────────────────────────

-- 3.11 Fotografías 360° (era cotizar sin precio)
UPDATE precios_servicios
   SET tipo_precio    = 'fijo',
       precio_minimo  = 120,
       cotizable_auto = true,
       servicio       = 'Fotografías 360°',
       descripcion    = 'Sesión de fotografías 360° de la propiedad'
 WHERE codigo = '3.11';

-- 3.10 Video recorrido (era cotizar sin precio)
UPDATE precios_servicios
   SET tipo_precio    = 'fijo',
       precio_minimo  = 150,
       cotizable_auto = true,
       servicio       = 'Video recorrido',
       descripcion    = 'Video de recorrido por la propiedad'
 WHERE codigo = '3.10';

-- 3.9 desactivar (duplicado de 3.6)
UPDATE precios_servicios
   SET activo = false
 WHERE codigo = '3.9';

-- 3.6 Gemelo digital 3D / Levantamiento 3D (unificado, precio_minimo real)
UPDATE precios_servicios
   SET servicio       = 'Gemelo digital 3D / Levantamiento 3D',
       descripcion    = 'Escaneo 3D con modelo gemelo digital',
       precio_minimo  = 200,
       cotizable_auto = true
 WHERE codigo = '3.6';

-- 3.1 Planos 2D DWG
UPDATE precios_servicios
   SET precio_minimo  = 150,
       cotizable_auto = true
 WHERE codigo = '3.1';

-- 3.2 Planos 2D PDF (precio_minimo era 15 — corregido)
UPDATE precios_servicios
   SET precio_minimo  = 150,
       cotizable_auto = true
 WHERE codigo = '3.2';

-- 3.7 Medición remota
UPDATE precios_servicios
   SET servicio       = 'Medición remota',
       descripcion    = 'Medición remota con modelo 3D',
       precio_minimo  = 60,
       cotizable_auto = true
 WHERE codigo = '3.7';

-- 3.8 Vistas dollhouse
UPDATE precios_servicios
   SET precio_minimo  = 80,
       cotizable_auto = true
 WHERE codigo = '3.8';

-- 3.3, 3.4, 3.5
UPDATE precios_servicios
   SET precio_minimo  = 40,
       cotizable_auto = true
 WHERE codigo IN ('3.3','3.4','3.5');

-- ── C. Filas nuevas ────────────────────────────────────────────────────────────

INSERT INTO precios_servicios
  (codigo, categoria, servicio, descripcion, tipo_precio, precio_minimo, cotizable_auto, activo, orden)
SELECT '4.1', 'Fotografía', 'Fotografía profesional',
       'Sesión fotográfica profesional de la propiedad',
       'fijo', 250, true, true, 18
 WHERE NOT EXISTS (SELECT 1 FROM precios_servicios WHERE codigo = '4.1');

INSERT INTO precios_servicios
  (codigo, categoria, servicio, descripcion, tipo_precio, precio_minimo, cotizable_auto, activo, orden)
SELECT '4.2', 'Video', 'Video aéreo con drone',
       'Toma aérea con drone de la propiedad',
       'fijo', 300, true, true, 19
 WHERE NOT EXISTS (SELECT 1 FROM precios_servicios WHERE codigo = '4.2');

-- ── D. Paquetes — tipo 'paquete' + descuento + piso + componentes ──────────────

-- BÁSICO (2.1): fotos 360° + video recorrido + tour virtual (5 componentes)
UPDATE precios_servicios
   SET tipo_precio           = 'paquete',
       descuento_paquete_pct = 5,
       precio_minimo         = 250,
       cotizable_auto        = true,
       componentes_ids       = (
         SELECT jsonb_agg(id ORDER BY codigo)
           FROM precios_servicios
          WHERE codigo IN ('1.1','1.2','1.3','3.10','3.11')
            AND activo = true
       )
 WHERE codigo = '2.1';

-- INTERMEDIO (2.2): básico + gemelo 3D + planos 2D PDF + dollhouse + medición remota (9 componentes)
UPDATE precios_servicios
   SET tipo_precio           = 'paquete',
       descuento_paquete_pct = 10,
       precio_minimo         = 500,
       cotizable_auto        = true,
       componentes_ids       = (
         SELECT jsonb_agg(id ORDER BY codigo)
           FROM precios_servicios
          WHERE codigo IN ('1.1','1.2','1.3','3.2','3.6','3.7','3.8','3.10','3.11')
            AND activo = true
       )
 WHERE codigo = '2.2';

-- PREMIUM (2.3): intermedio + fotografía profesional + planos DWG + video drone (12 componentes)
UPDATE precios_servicios
   SET tipo_precio           = 'paquete',
       descuento_paquete_pct = 15,
       precio_minimo         = 1000,
       cotizable_auto        = true,
       componentes_ids       = (
         SELECT jsonb_agg(id ORDER BY codigo)
           FROM precios_servicios
          WHERE codigo IN ('1.1','1.2','1.3','3.1','3.2','3.6','3.7','3.8','3.10','3.11','4.1','4.2')
            AND activo = true
       )
 WHERE codigo = '2.3';

-- ── Verificación ───────────────────────────────────────────────────────────────
-- Esperado: Básico 5, Intermedio 9, Premium 12 componentes

SELECT
  codigo,
  servicio,
  tipo_precio,
  precio_minimo,
  descuento_paquete_pct,
  cotizable_auto,
  jsonb_array_length(componentes_ids) AS n_componentes
FROM precios_servicios
WHERE codigo IN ('2.1','2.2','2.3')
ORDER BY codigo;
