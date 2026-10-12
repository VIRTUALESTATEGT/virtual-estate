-- 079_propiedades_codigo.sql
-- Agrega código único legible (VE-026, VE-027, …) a la tabla propiedades.

ALTER TABLE propiedades ADD COLUMN IF NOT EXISTS codigo VARCHAR(10);

-- Secuencia: empieza en 26, VE-001..025 quedan como reserva/legacy
CREATE SEQUENCE IF NOT EXISTS prop_codigo_seq START 26;

-- Asignar códigos a las filas existentes en orden de id
UPDATE propiedades
SET codigo = 'VE-' || LPAD((25 + rn)::TEXT, 3, '0')
FROM (
  SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rn
  FROM propiedades
  WHERE codigo IS NULL
) sub
WHERE propiedades.id = sub.id;

-- Avanzar la secuencia más allá de los códigos ya asignados
DO $$
DECLARE total_rows INT;
BEGIN
  SELECT COUNT(*) INTO total_rows FROM propiedades WHERE codigo IS NOT NULL;
  IF total_rows > 0 THEN
    PERFORM setval('prop_codigo_seq', 25 + total_rows);
  END IF;
END;
$$;

-- Restricción única
ALTER TABLE propiedades ADD CONSTRAINT IF NOT EXISTS propiedades_codigo_unique UNIQUE (codigo);

-- Trigger: genera código automáticamente en cada INSERT si no se proveyó
CREATE OR REPLACE FUNCTION set_propiedad_codigo()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.codigo IS NULL OR NEW.codigo = '' THEN
    NEW.codigo := 'VE-' || LPAD(nextval('prop_codigo_seq')::TEXT, 3, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_propiedad_codigo ON propiedades;
CREATE TRIGGER trg_propiedad_codigo
  BEFORE INSERT ON propiedades
  FOR EACH ROW EXECUTE FUNCTION set_propiedad_codigo();
