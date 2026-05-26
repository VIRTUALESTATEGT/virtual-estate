-- Migration 017: send-channel tracking for cotizaciones

ALTER TABLE cotizaciones
  ADD COLUMN IF NOT EXISTS metodo_envio_manual VARCHAR(30),  -- 'whatsapp','email','facebook','instagram','ninguno'
  ADD COLUMN IF NOT EXISTS fecha_envio_manual  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS estado_envio        VARCHAR(20) DEFAULT 'pendiente'
    CONSTRAINT cot_estado_envio_check CHECK (estado_envio IN ('pendiente','enviado','error'));
