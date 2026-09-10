-- ============================================================
-- Migration 067: Renames del catálogo de adicionales (con cascade)
-- ============================================================
-- Cada rename hace DOS pasos en orden:
--   1. UPDATE propiedades_adicionales (cascade - preserva datos de propiedades)
--   2. UPDATE adicionales_catalogo     (actualiza el catálogo)
-- El UPDATE de tipo se hace en la migración 068.
-- Al final: desactiva Hidromasaje (sin match en lista nueva).
-- ============================================================
-- PRE-FLIGHT: verificar cuántas propiedades tienen 'Lobby y Recepción'
--   SELECT pa.propiedad_id, p.direccion
--   FROM propiedades_adicionales pa
--   JOIN propiedades p ON p.id = pa.propiedad_id
--   WHERE pa.nombre = 'Lobby y Recepción';
-- Si retorna filas, esas propiedades quedarán con 'Lobby'.
-- 'Recepción' se inserta como item nuevo en la migración 069.
-- ============================================================

BEGIN;

-- -- 1. SERVICIOS BÁSICOS (8 renames) ----------------------------------------

UPDATE propiedades_adicionales SET nombre = 'Drenaje sanitario'             WHERE nombre = 'Drenaje';
UPDATE adicionales_catalogo      SET nombre = 'Drenaje sanitario'             WHERE nombre = 'Drenaje';

UPDATE propiedades_adicionales SET nombre = 'Cable / TV'                    WHERE nombre = 'Cable';
UPDATE adicionales_catalogo      SET nombre = 'Cable / TV'                    WHERE nombre = 'Cable';

UPDATE propiedades_adicionales SET nombre = 'Gas natural'                   WHERE nombre = 'Gas Natural';
UPDATE adicionales_catalogo      SET nombre = 'Gas natural'                   WHERE nombre = 'Gas Natural';

UPDATE propiedades_adicionales SET nombre = 'Internet disponible'           WHERE nombre = 'Internet';
UPDATE adicionales_catalogo      SET nombre = 'Internet disponible'           WHERE nombre = 'Internet';

UPDATE propiedades_adicionales SET nombre = 'Pavimento o calles asfaltadas' WHERE nombre = 'Pavimento';
UPDATE adicionales_catalogo      SET nombre = 'Pavimento o calles asfaltadas' WHERE nombre = 'Pavimento';

UPDATE propiedades_adicionales SET nombre = 'Telefonía'                     WHERE nombre = 'Teléfono';
UPDATE adicionales_catalogo      SET nombre = 'Telefonía'                     WHERE nombre = 'Teléfono';

UPDATE propiedades_adicionales SET nombre = 'Paneles solares'               WHERE nombre = 'Panel solar';
UPDATE adicionales_catalogo      SET nombre = 'Paneles solares'               WHERE nombre = 'Panel solar';

UPDATE propiedades_adicionales SET nombre = 'Planta eléctrica / generador'  WHERE nombre = 'Planta eléctrica';
UPDATE adicionales_catalogo      SET nombre = 'Planta eléctrica / generador'  WHERE nombre = 'Planta eléctrica';

-- -- 2. ESPACIOS Y AMBIENTES (6 renames) -------------------------------------

UPDATE propiedades_adicionales SET nombre = 'Dos niveles'         WHERE nombre = 'Dos plantas';
UPDATE adicionales_catalogo      SET nombre = 'Dos niveles'         WHERE nombre = 'Dos plantas';

UPDATE propiedades_adicionales SET nombre = 'Oficina privada'     WHERE nombre = 'Oficina';
UPDATE adicionales_catalogo      SET nombre = 'Oficina privada'     WHERE nombre = 'Oficina';

UPDATE propiedades_adicionales SET nombre = 'Planta baja'         WHERE nombre = 'Planta Baja';
UPDATE adicionales_catalogo      SET nombre = 'Planta baja'         WHERE nombre = 'Planta Baja';

UPDATE propiedades_adicionales SET nombre = 'Suite principal'     WHERE nombre = 'Suite';
UPDATE adicionales_catalogo      SET nombre = 'Suite principal'     WHERE nombre = 'Suite';

UPDATE propiedades_adicionales SET nombre = 'Tres o más niveles'  WHERE nombre = 'Tres plantas';
UPDATE adicionales_catalogo      SET nombre = 'Tres o más niveles'  WHERE nombre = 'Tres plantas';

UPDATE propiedades_adicionales SET nombre = 'Roof garden privado' WHERE nombre = 'Roof garden';
UPDATE adicionales_catalogo      SET nombre = 'Roof garden privado' WHERE nombre = 'Roof garden';

-- -- 3. ADICIONALES Y EQUIPAMIENTO (12 renames) ------------------------------

UPDATE propiedades_adicionales SET nombre = 'Piscina privada'             WHERE nombre = 'Alberca';
UPDATE adicionales_catalogo      SET nombre = 'Piscina privada'             WHERE nombre = 'Alberca';

UPDATE propiedades_adicionales SET nombre = 'Apto crédito hipotecario'    WHERE nombre = 'Apto crédito';
UPDATE adicionales_catalogo      SET nombre = 'Apto crédito hipotecario'    WHERE nombre = 'Apto crédito';

UPDATE propiedades_adicionales SET nombre = 'Apto para mascotas'          WHERE nombre = 'Apto mascotas';
UPDATE adicionales_catalogo      SET nombre = 'Apto para mascotas'          WHERE nombre = 'Apto mascotas';

UPDATE propiedades_adicionales SET nombre = 'Jacuzzi privado'             WHERE nombre = 'Jacuzzi';
UPDATE adicionales_catalogo      SET nombre = 'Jacuzzi privado'             WHERE nombre = 'Jacuzzi';

UPDATE propiedades_adicionales SET nombre = 'Asador / parrilla privada'   WHERE nombre = 'Parrilla';
UPDATE adicionales_catalogo      SET nombre = 'Asador / parrilla privada'   WHERE nombre = 'Parrilla';

UPDATE propiedades_adicionales SET nombre = 'Muro perimetral'             WHERE nombre = 'Perimetral';
UPDATE adicionales_catalogo      SET nombre = 'Muro perimetral'             WHERE nombre = 'Perimetral';

UPDATE propiedades_adicionales SET nombre = 'Sistema de riego automático' WHERE nombre = 'Riego automático';
UPDATE adicionales_catalogo      SET nombre = 'Sistema de riego automático' WHERE nombre = 'Riego automático';

UPDATE propiedades_adicionales SET nombre = 'Seguridad 24 horas'          WHERE nombre = 'Seguridad 24hs';
UPDATE adicionales_catalogo      SET nombre = 'Seguridad 24 horas'          WHERE nombre = 'Seguridad 24hs';

UPDATE propiedades_adicionales SET nombre = 'Simulador de golf'           WHERE nombre = 'Simulador de Golf';
UPDATE adicionales_catalogo      SET nombre = 'Simulador de golf'           WHERE nombre = 'Simulador de Golf';

UPDATE propiedades_adicionales SET nombre = 'Solárium'                    WHERE nombre = 'Solario';
UPDATE adicionales_catalogo      SET nombre = 'Solárium'                    WHERE nombre = 'Solario';

UPDATE propiedades_adicionales SET nombre = 'Área de yoga'                WHERE nombre = 'Área de Yoga';
UPDATE adicionales_catalogo      SET nombre = 'Área de yoga'                WHERE nombre = 'Área de Yoga';

UPDATE propiedades_adicionales SET nombre = 'Lobby'                       WHERE nombre = 'Lobby y Recepción';
UPDATE adicionales_catalogo      SET nombre = 'Lobby'                       WHERE nombre = 'Lobby y Recepción';

-- -- 4. AMENIDADES COMUNITARIAS (4 renames) ----------------------------------

UPDATE propiedades_adicionales SET nombre = 'Área deportiva'               WHERE nombre = 'Centro de deportes';
UPDATE adicionales_catalogo      SET nombre = 'Área deportiva'               WHERE nombre = 'Centro de deportes';

UPDATE propiedades_adicionales SET nombre = 'Cine / sala de cine'          WHERE nombre = 'Cine';
UPDATE adicionales_catalogo      SET nombre = 'Cine / sala de cine'          WHERE nombre = 'Cine';

UPDATE propiedades_adicionales SET nombre = 'Fire pit / fogatero'          WHERE nombre = 'Fogatero';
UPDATE adicionales_catalogo      SET nombre = 'Fire pit / fogatero'          WHERE nombre = 'Fogatero';

UPDATE propiedades_adicionales SET nombre = 'SUM / salón de usos múltiples' WHERE nombre = 'SUM';
UPDATE adicionales_catalogo      SET nombre = 'SUM / salón de usos múltiples' WHERE nombre = 'SUM';

-- -- 5. DESACTIVAR (1 item sin match en lista nueva) --------------------------

UPDATE adicionales_catalogo SET activo = false WHERE nombre = 'Hidromasaje';

-- -- VERIFICACIÓN -------------------------------------------------------------
-- Debe retornar 0 filas (ningún adicional de propiedad queda huérfano)
-- SELECT DISTINCT pa.nombre
-- FROM propiedades_adicionales pa
-- LEFT JOIN adicionales_catalogo ac ON ac.nombre = pa.nombre
-- WHERE ac.nombre IS NULL
-- ORDER BY pa.nombre;

COMMIT;
