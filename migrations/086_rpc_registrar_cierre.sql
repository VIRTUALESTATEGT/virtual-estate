-- Migration 086: RPC atómica para registrar cierre + comisión + actualizar estado de propiedad.
-- Los valores numéricos se calculan en JavaScript y se pasan al RPC.
-- La función ejecuta todo en una sola transacción implícita de PL/pgSQL:
--   1. Bloquea la propiedad (SELECT FOR UPDATE) → error si no existe.
--   2. Verifica que estado_publicacion no sea ya 'vendida' ni 'rentada'.
--   3. Inserta en cierres_propiedad.
--   4. Inserta en comisiones.
--   5. Actualiza propiedades.estado_publicacion a 'vendida' o 'rentada'.
-- Retorna: jsonb { "cierre": {...}, "comision": {...} }

BEGIN;

CREATE OR REPLACE FUNCTION rpc_registrar_cierre(
  p_propiedad_id                BIGINT,
  p_tipo                        TEXT,       -- 'venta' | 'renta'
  p_precio_final                NUMERIC,
  p_moneda                      TEXT,
  p_fecha_cierre                DATE,
  p_agente_cierre_id            BIGINT,
  p_pct_cierre_override         NUMERIC,
  p_monto_cierre_fijo_override  NUMERIC,
  p_moneda_cierre_fijo_override TEXT,
  p_comision_ve_cobrada         NUMERIC,
  p_notas                       TEXT,
  -- campos de comisión ya calculados en JS
  p_agente_id_comision          BIGINT,
  p_pct_comision                NUMERIC,
  p_monto_comision              NUMERIC,
  p_moneda_comision             TEXT,   -- puede diferir de p_moneda cuando modo=monto_fijo
  p_modo                        TEXT,
  p_origen_pct                  TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
-- SECURITY INVOKER: corre como el rol que llama (service_role).
-- service_role no es superuser; omite RLS y tiene permisos sobre las tablas de public.
-- No requiere SET search_path porque no hay SECURITY DEFINER.
SECURITY INVOKER
AS $$
DECLARE
  v_prop     propiedades%ROWTYPE;
  v_cierre   cierres_propiedad%ROWTYPE;
  v_comision comisiones%ROWTYPE;
  v_nuevo_estado TEXT;
BEGIN
  -- 1. Bloquear la fila de la propiedad para evitar condiciones de carrera.
  SELECT * INTO v_prop
  FROM   propiedades
  WHERE  id = p_propiedad_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Propiedad % no encontrada', p_propiedad_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 2. Verificar que la propiedad no esté ya cerrada.
  IF v_prop.estado_publicacion IN ('vendida', 'rentada') THEN
    RAISE EXCEPTION 'La propiedad % ya está en estado ''%'' y no puede tener un nuevo cierre',
                    p_propiedad_id, v_prop.estado_publicacion
      USING ERRCODE = 'P0001';
  END IF;

  -- 3. Insertar el cierre.
  INSERT INTO cierres_propiedad (
    propiedad_id,
    tipo,
    precio_final,
    moneda,
    fecha_cierre,
    agente_cierre_id,
    pct_cierre_override,
    monto_cierre_fijo_override,
    moneda_cierre_fijo_override,
    comision_ve_cobrada,
    notas
  ) VALUES (
    p_propiedad_id,
    p_tipo,
    p_precio_final,
    p_moneda,
    p_fecha_cierre,
    p_agente_cierre_id,
    p_pct_cierre_override,
    p_monto_cierre_fijo_override,
    p_moneda_cierre_fijo_override,
    p_comision_ve_cobrada,
    p_notas
  )
  RETURNING * INTO v_cierre;

  -- 4. Insertar la comisión del agente.
  --    p_moneda_comision puede diferir de p_moneda cuando modo = 'monto_fijo'.
  INSERT INTO comisiones (
    agente_id,
    cierre_id,
    propiedad_id,
    tipo,
    pct_comision,
    monto_comision,
    moneda,
    modo,
    origen_pct,
    estado
  ) VALUES (
    p_agente_id_comision,
    v_cierre.id,
    p_propiedad_id,
    'cierre_propiedad',
    p_pct_comision,
    p_monto_comision,
    p_moneda_comision,
    p_modo,
    p_origen_pct,
    'no_validada'
  )
  RETURNING * INTO v_comision;

  -- 5. Actualizar el estado de la propiedad en la misma transacción.
  v_nuevo_estado := CASE WHEN p_tipo = 'venta' THEN 'vendida' ELSE 'rentada' END;

  UPDATE propiedades
  SET    estado_publicacion = v_nuevo_estado
  WHERE  id = p_propiedad_id;

  RETURN jsonb_build_object(
    'cierre',   to_jsonb(v_cierre),
    'comision', to_jsonb(v_comision)
  );
END;
$$;

-- Quitar el EXECUTE que PostgreSQL otorga a PUBLIC por defecto.
REVOKE ALL ON FUNCTION rpc_registrar_cierre(
  BIGINT, TEXT, NUMERIC, TEXT, DATE, BIGINT,
  NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT,
  BIGINT, NUMERIC, NUMERIC, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;

-- Solo el service_role (clave de servidor) puede llamar esta función.
GRANT EXECUTE ON FUNCTION rpc_registrar_cierre(
  BIGINT, TEXT, NUMERIC, TEXT, DATE, BIGINT,
  NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT,
  BIGINT, NUMERIC, NUMERIC, TEXT, TEXT, TEXT
) TO service_role;

COMMIT;

-- Verificación (fuera de la transacción)
SELECT routine_name, routine_type, security_type
FROM   information_schema.routines
WHERE  routine_schema = 'public' AND routine_name = 'rpc_registrar_cierre';
