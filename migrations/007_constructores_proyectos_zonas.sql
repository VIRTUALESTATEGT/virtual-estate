-- Migration 007: constructores table, proyectos extra columns, Guatemala zones seed

-- 1. Constructores table
CREATE TABLE IF NOT EXISTS constructores (
  id              BIGSERIAL PRIMARY KEY,
  nombre_empresa  TEXT NOT NULL,
  contacto        TEXT,
  especialidad    TEXT,
  email           TEXT,
  telefono        TEXT,
  estado          TEXT DEFAULT 'Activo',
  notas           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Add cotizacion_id and propiedad_id to proyectos
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS cotizacion_id BIGINT REFERENCES cotizaciones(id) ON DELETE SET NULL;
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS propiedad_id  BIGINT REFERENCES propiedades(id)  ON DELETE SET NULL;

-- 3. Guatemala zones — insert only if not already present
WITH new_zones(zona, nivel_riesgo, descripcion, aceptar_trabajos, requiere_verificacion_extra) AS (VALUES
  ('Guatemala - Zona 1 (Centro Histórico)', 'amarillo', 'Centro histórico, alta densidad', true, true),
  ('Guatemala - Zona 2', 'verde', 'Residencial/mixta', true, false),
  ('Guatemala - Zona 3', 'amarillo', 'Zona industrial/comercial', true, false),
  ('Guatemala - Zona 4', 'verde', 'Zona financiera y comercial', true, false),
  ('Guatemala - Zona 5', 'verde', 'Residencial', true, false),
  ('Guatemala - Zona 6', 'verde', 'Residencial', true, false),
  ('Guatemala - Zona 7', 'amarillo', 'Residencial periférica', true, false),
  ('Guatemala - Zona 8', 'amarillo', 'Residencial/mixta', true, false),
  ('Guatemala - Zona 9', 'verde', 'Zona financiera premium', true, false),
  ('Guatemala - Zona 10 (Zona Viva)', 'verde', 'Zona premium y comercial', true, false),
  ('Guatemala - Zona 11', 'verde', 'Residencial', true, false),
  ('Guatemala - Zona 12', 'verde', 'Residencial/universitaria', true, false),
  ('Guatemala - Zona 13', 'verde', 'Aeropuerto y área residencial', true, false),
  ('Guatemala - Zona 14', 'verde', 'Zona residencial premium', true, false),
  ('Guatemala - Zona 15', 'verde', 'Residencial / Vista Hermosa', true, false),
  ('Guatemala - Zona 16', 'verde', 'Residencial / Cayalá', true, false),
  ('Guatemala - Zona 17', 'amarillo', 'Residencial periférica', true, false),
  ('Guatemala - Zona 18', 'rojo', 'Zona de alto riesgo', false, true),
  ('Guatemala - Zona 19', 'rojo', 'Zona de alto riesgo', false, true),
  ('Guatemala - Zona 21', 'rojo', 'Zona de alto riesgo', false, true),
  ('Mixco', 'verde', 'Municipio con alta densidad residencial', true, false),
  ('Villa Nueva', 'verde', 'Municipio en crecimiento', true, false),
  ('San Miguel Petapa', 'verde', 'Área residencial', true, false),
  ('Villa Canales', 'verde', 'Área residencial/rural', true, false),
  ('Amatitlán', 'verde', 'Área lacustre', true, false),
  ('Santa Catarina Pinula', 'verde', 'Área residencial premium', true, false),
  ('San José Pinula', 'verde', 'Área residencial', true, false),
  ('Fraijanes', 'verde', 'Área residencial', true, false),
  ('Chinautla', 'amarillo', 'Área periférica', true, false),
  ('San Pedro Ayampuc', 'amarillo', 'Área periférica', true, false),
  ('Palencia', 'verde', 'Área rural/residencial', true, false),
  ('Antigua Guatemala (Sacatepéquez)', 'verde', 'Zona turística y colonial premium', true, false),
  ('Chimaltenango', 'verde', 'Ciudad departamental', true, false),
  ('Escuintla', 'verde', 'Ciudad departamental/costera', true, false),
  ('Quetzaltenango (Xela)', 'verde', 'Segunda ciudad del país', true, false),
  ('Huehuetenango', 'verde', 'Ciudad departamental', true, false),
  ('Cobán (Alta Verapaz)', 'verde', 'Ciudad departamental', true, false),
  ('Mazatenango (Suchitepéquez)', 'verde', 'Ciudad departamental', true, false),
  ('Retalhuleu', 'verde', 'Ciudad departamental', true, false),
  ('San Marcos', 'verde', 'Ciudad departamental', true, false),
  ('Puerto Barrios (Izabal)', 'verde', 'Puerto y ciudad costera', true, false),
  ('Zacapa', 'verde', 'Ciudad departamental', true, false),
  ('Chiquimula', 'verde', 'Ciudad departamental', true, false),
  ('Jalapa', 'verde', 'Ciudad departamental', true, false),
  ('Jutiapa', 'verde', 'Ciudad departamental', true, false),
  ('Flores (Petén)', 'verde', 'Zona turística', true, false),
  ('Sololá', 'verde', 'Zona lacustre/turística', true, false),
  ('Totonicapán', 'verde', 'Ciudad departamental', true, false),
  ('El Progreso', 'verde', 'Ciudad departamental', true, false),
  ('Baja Verapaz', 'verde', 'Departamento', true, false)
)
INSERT INTO zonas_seguridad (zona, nivel_riesgo, descripcion, aceptar_trabajos, requiere_verificacion_extra)
SELECT z.zona, z.nivel_riesgo, z.descripcion, z.aceptar_trabajos, z.requiere_verificacion_extra
FROM new_zones z
WHERE NOT EXISTS (SELECT 1 FROM zonas_seguridad zs WHERE zs.zona = z.zona);
