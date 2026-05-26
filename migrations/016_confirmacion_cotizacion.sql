-- Migration 016: Confirmación de cotización + auto-conversión Lead→Cliente

-- 1. Extend clientes table
ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS lead_id                      BIGINT REFERENCES leads(id),
  ADD COLUMN IF NOT EXISTS codigo_cliente               VARCHAR(20) UNIQUE,
  ADD COLUMN IF NOT EXISTS confirmacion_timestamp       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmacion_ip              VARCHAR(45),
  ADD COLUMN IF NOT EXISTS confirmacion_version_terminos VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_clientes_lead_id      ON clientes(lead_id);
CREATE INDEX IF NOT EXISTS idx_clientes_codigo       ON clientes(codigo_cliente);

-- 2. Extend cotizaciones table
ALTER TABLE cotizaciones
  ADD COLUMN IF NOT EXISTS lead_id              BIGINT REFERENCES leads(id),
  ADD COLUMN IF NOT EXISTS anticipo_confirmado  NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS fecha_confirmacion   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ip_confirmacion      VARCHAR(45),
  ADD COLUMN IF NOT EXISTS estado_confirmacion  VARCHAR(20) DEFAULT 'pendiente'
    CONSTRAINT cot_estado_confirmacion_check CHECK (
      estado_confirmacion IN ('pendiente','confirmado','vencido')
    );

CREATE INDEX IF NOT EXISTS idx_cot_lead_id            ON cotizaciones(lead_id);
CREATE INDEX IF NOT EXISTS idx_cot_estado_confirmacion ON cotizaciones(estado_confirmacion);

-- 3. Sequence table (never repeats, single row)
CREATE TABLE IF NOT EXISTS cotizacion_secuencia (
  id            SERIAL PRIMARY KEY,
  ultimo_numero BIGINT NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO cotizacion_secuencia (id, ultimo_numero)
VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE cotizacion_secuencia ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_secuencia" ON cotizacion_secuencia
  FOR ALL USING (true) WITH CHECK (true);

-- Atomic increment function — avoids race conditions
CREATE OR REPLACE FUNCTION incrementar_secuencia_cliente()
RETURNS BIGINT AS $$
DECLARE
  nuevo_numero BIGINT;
BEGIN
  UPDATE cotizacion_secuencia
  SET ultimo_numero = ultimo_numero + 1, updated_at = NOW()
  WHERE id = 1
  RETURNING ultimo_numero INTO nuevo_numero;
  RETURN nuevo_numero;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Audit trail for confirmations
CREATE TABLE IF NOT EXISTS confirmaciones_registro (
  id             BIGSERIAL PRIMARY KEY,
  cotizacion_id  BIGINT REFERENCES cotizaciones(id) ON DELETE SET NULL,
  lead_id        BIGINT REFERENCES leads(id)         ON DELETE SET NULL,
  cliente_id     BIGINT REFERENCES clientes(id)      ON DELETE SET NULL,
  monto          NUMERIC(12,2),
  ip             VARCHAR(45),
  version_terminos VARCHAR(50),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conf_reg_cotizacion ON confirmaciones_registro(cotizacion_id);
CREATE INDEX IF NOT EXISTS idx_conf_reg_cliente    ON confirmaciones_registro(cliente_id);

ALTER TABLE confirmaciones_registro ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_confirmaciones_registro" ON confirmaciones_registro
  FOR ALL USING (true) WITH CHECK (true);
