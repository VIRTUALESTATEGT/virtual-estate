-- Migration 075: 5 nuevos adicionales al catálogo
-- Verificados: ninguno existe en migraciones 063–073

INSERT INTO adicionales_catalogo (tipo, nombre, activo, destacado, orden)
VALUES
  ('amenidades_compartidas',    'Guardalanchas',  true, false, 0),
  ('seguridad_estacionamiento', 'Guardianía',     true, false, 0),
  ('espacios_privados',         'Ducha exterior', true, false, 0),
  ('espacios_privados',         'Pila',           true, false, 0),
  ('equipamiento_confort',      'Congelador',     true, false, 0)
ON CONFLICT (nombre) DO NOTHING;

-- Verificación
SELECT tipo, nombre, activo, destacado
FROM adicionales_catalogo
WHERE nombre IN ('Guardalanchas','Guardianía','Ducha exterior','Pila','Congelador')
ORDER BY tipo, nombre;
