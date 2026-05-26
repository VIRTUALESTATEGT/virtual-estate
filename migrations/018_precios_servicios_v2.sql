-- Migration 018: rebuild precios_servicios with full pricing structure

DROP TABLE IF EXISTS precios_servicios CASCADE;

CREATE TABLE precios_servicios (
  id          BIGSERIAL PRIMARY KEY,
  codigo      VARCHAR(10)  NOT NULL,
  categoria   VARCHAR(100) NOT NULL,
  servicio    VARCHAR(150) NOT NULL,
  descripcion VARCHAR(300),
  tipo_precio VARCHAR(30)  NOT NULL CHECK (tipo_precio IN ('fijo','por_m2','rango_m2','cotizar')),
  precio_fijo       NUMERIC(10,2),
  precio_por_m2     NUMERIC(10,4),
  rango_m2_min      INT,
  rango_m2_max      INT,
  precio_en_rango   NUMERIC(10,2),
  precio_minimo     NUMERIC(10,2),
  notas       TEXT,
  activo      BOOLEAN DEFAULT true,
  orden       INT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE precios_servicios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_precios" ON precios_servicios FOR ALL USING (true) WITH CHECK (true);

-- ── Initial data ────────────────────────────────────────────────────────────

INSERT INTO precios_servicios (codigo, categoria, servicio, descripcion, tipo_precio, precio_por_m2, rango_m2_min, rango_m2_max, precio_minimo, notas, orden) VALUES
-- Tours Virtuales
('1.1','Tours Virtuales','Tours Virtuales','Pequeña (hasta 120 m²)','por_m2',3.00,0,120,250.00,'Precio mínimo $250.00',1),
('1.2','Tours Virtuales','Tours Virtuales','Mediana (121–250 m²)','por_m2',2.50,121,250,NULL,NULL,2),
('1.3','Tours Virtuales','Tours Virtuales','Grande (250 m²+)','por_m2',1.75,251,99999,NULL,NULL,3);

INSERT INTO precios_servicios (codigo, categoria, servicio, descripcion, tipo_precio, precio_minimo, notas, orden) VALUES
-- Paquetes Inmobiliarios
('2.1','Paquetes Inmobiliarios','Paquete BÁSICO','Fotos 360° + Video + TOTAL','fijo',250.00,'Paquete mínimo $250.00',4),
('2.2','Paquetes Inmobiliarios','Paquete INTERMEDIO','Fotos + Gemelo 3D + Video + Planos 2D','fijo',500.00,'Precio mínimo $500.00',5),
('2.3','Paquetes Inmobiliarios','Paquete PREMIUM','Fotos + Gemelo + DWG + Dollhouse + TOTAL','fijo',1000.00,'Precio mínimo $1,000.00',6);

INSERT INTO precios_servicios (codigo, categoria, servicio, descripcion, tipo_precio, precio_por_m2, precio_minimo, notas, orden) VALUES
-- AS-BUILT por m²
('3.1','AS-BUILT','Planos 2D DWG','Schematic floor plan','por_m2',3.00,NULL,NULL,7),
('3.2','AS-BUILT','Planos 2D PDF','Con áreas y metrajes','por_m2',3.50,15.00,'$15.00 por plano en portal',8),
('3.3','AS-BUILT','Cotas','Cotas de medidas','por_m2',0.40,NULL,NULL,9),
('3.4','AS-BUILT','Muros, puertas y ventanas','Detalles constructivos','por_m2',0.40,NULL,NULL,10),
('3.5','AS-BUILT','Anotaciones básicas','Áreas, acabados, elementos','por_m2',0.40,NULL,NULL,11),
('3.6','AS-BUILT','Levantamiento 3D','Modelo 3D completo','por_m2',2.00,NULL,NULL,12),
('3.7','AS-BUILT','Modelo con toma de medidas','Incluye medidas en 3D','por_m2',0.40,NULL,NULL,13),
('3.8','AS-BUILT','Vistas dollhouse','Vistas isométricas','por_m2',0.40,NULL,NULL,14);

INSERT INTO precios_servicios (codigo, categoria, servicio, descripcion, tipo_precio, notas, orden) VALUES
-- AS-BUILT a cotizar
('3.9', 'AS-BUILT','Escaneo gemelo digital','Según alcance','cotizar','Cotizar según alcance',15),
('3.10','AS-BUILT','Recorrido visual','Video básico','cotizar',NULL,16),
('3.11','AS-BUILT','Documentación fotográfica 360°','Exteriores','cotizar',NULL,17);
