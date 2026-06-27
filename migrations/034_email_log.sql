-- Migration 034: email_log — registro de emails enviados para deduplicación
CREATE TABLE IF NOT EXISTS email_log (
  id             BIGSERIAL    PRIMARY KEY,
  destinatario   TEXT         NOT NULL,
  tipo_email     TEXT         NOT NULL,   -- 'bienvenida','recordatorio_cotizacion','confirmacion','envio_cotizacion', etc.
  referencia_id  BIGINT,                  -- cliente_id o cotizacion_id según el caso
  estado         TEXT         NOT NULL DEFAULT 'enviado'
                   CHECK (estado IN ('enviado', 'error')),
  error_detalle  TEXT,
  timestamp      TIMESTAMPTZ  DEFAULT NOW()
);

-- Índice de deduplicación: ¿ya le mandé este tipo de email a este cliente/cotización?
CREATE INDEX IF NOT EXISTS idx_email_log_dedup
  ON email_log (destinatario, tipo_email, referencia_id);

ALTER TABLE email_log ENABLE ROW LEVEL SECURITY;

-- Mismo modelo que notificaciones_admin: solo staff autenticado vía JWT.
-- El backend usa SUPABASE_SECRET_KEY (service role) que bypassa RLS — no requiere policy.
-- Anon key queda completamente bloqueada (contiene emails de clientes).
CREATE POLICY "email_log_staff"
  ON email_log FOR ALL
  TO authenticated
  USING (
    auth_is_superadmin()
    OR auth_user_role() IN ('gerente', 'admin')
  )
  WITH CHECK (true);
