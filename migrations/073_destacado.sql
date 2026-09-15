-- Migración 073: campo destacado en adicionales_catalogo
--
-- destacado = true → el adicional aparece primero en el detalle de propiedad
-- y puede togglarse desde el CRM.

ALTER TABLE adicionales_catalogo
  ADD COLUMN IF NOT EXISTS destacado BOOLEAN NOT NULL DEFAULT false;

-- Seed: 35 adicionales marcados como destacados (5 por cada una de 7 categorías)
-- Nombres verificados contra migraciones 063 → 067 → 068 → 069.

UPDATE adicionales_catalogo SET destacado = true
WHERE nombre IN (
  -- Espacios privados
  'Jardín', 'Terraza', 'Balcón', 'Garaje', 'Estudio',

  -- Equipamiento y confort
  -- (Nota: 'Cocina equipada' tiene tipo=espacios_privados por migración 068)
  'Amueblado', 'Aire acondicionado', 'Cocina equipada',
  'Línea blanca incluida', 'Domótica',

  -- Seguridad y estacionamiento
  'Seguridad 24 horas', 'Condominio cerrado', 'Estacionamiento asignado',
  'Elevador', 'Circuito cerrado de cámaras',

  -- Amenidades compartidas
  'Piscina comunitaria', 'Gimnasio', 'Área de juegos infantiles',
  'Salón social', 'Coworking',

  -- Características físicas
  'Iluminación natural', 'Vista panorámica', 'Construcción nueva',
  'Un nivel', 'Remodelado',

  -- Políticas y condiciones
  'Apto para mascotas', 'Apto crédito hipotecario', 'Entrega inmediata',
  'Renta amueblada', 'Apto para Airbnb / renta corta',

  -- Servicios e infraestructura
  'Agua potable', 'Electricidad', 'Internet disponible',
  'Paneles solares', 'Planta eléctrica / generador'
);

-- Verificación: debe retornar exactamente 35 filas
SELECT tipo, nombre
FROM adicionales_catalogo
WHERE destacado = true
ORDER BY tipo, nombre;
