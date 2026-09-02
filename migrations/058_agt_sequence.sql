-- Migración 058: secuencia atómica para códigos de agente (AGT-XXXX)
--
-- Problema: el generador anterior usaba COUNT(*) WHERE estado='aprobado',
-- lo que permitía reutilizar números si se borraba un registro aprobado
-- y generaba colisiones en aprobaciones simultáneas.
--
-- Solución: secuencia nativa de PostgreSQL (monotónica, atómica, nunca
-- retrocede aunque se hagan rollbacks o borrados).
--
-- Formato nuevo: AGT-XXXX (4 dígitos, sin prefijo de año).
-- Formato anterior: AGT-YY-XXXXX — obsoleto.

-- 1. Crear la secuencia. Arranca en 2 porque AGT-0001 ya fue asignado
--    al código de prueba que se migra abajo.
CREATE SEQUENCE IF NOT EXISTS agt_seq
  START WITH 2
  INCREMENT BY 1
  NO CYCLE;

-- 2. Función atómica (mismo patrón que incrementar_secuencia_cliente)
CREATE OR REPLACE FUNCTION incrementar_secuencia_agente()
RETURNS integer LANGUAGE sql AS $$
  SELECT nextval('agt_seq')::integer;
$$;

-- 3. Migrar el código de prueba al formato nuevo en ambas tablas.
--    El LIKE 'AGT-__-%' captura el formato viejo AGT-26-00001.
UPDATE solicitudes_agente
  SET codigo_asignado = 'AGT-0001'
  WHERE codigo_asignado LIKE 'AGT-__-%';

UPDATE clientes
  SET codigo_agente = 'AGT-0001'
  WHERE codigo_agente LIKE 'AGT-__-%';

-- 4. Verificar resultado
SELECT id, nombre, estado, codigo_asignado
  FROM solicitudes_agente
  WHERE codigo_asignado IS NOT NULL;

SELECT id, email, codigo_agente
  FROM clientes
  WHERE codigo_agente IS NOT NULL;
