-- ══════════════════════════════════════════════════════════════════
-- Migration 002: Multicanal IA + Identity Verification + Risk Zones
-- Run in: Supabase Dashboard → SQL Editor
-- ══════════════════════════════════════════════════════════════════

-- 1. zonas_seguridad
CREATE TABLE IF NOT EXISTS zonas_seguridad (
  id                          BIGSERIAL PRIMARY KEY,
  zona                        TEXT NOT NULL,
  nivel_riesgo                TEXT NOT NULL CHECK (nivel_riesgo IN ('verde','amarillo','rojo')),
  descripcion                 TEXT,
  aceptar_trabajos            BOOLEAN NOT NULL DEFAULT TRUE,
  requiere_verificacion_extra BOOLEAN NOT NULL DEFAULT FALSE,
  created_at                  TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO zonas_seguridad (zona, nivel_riesgo, descripcion, aceptar_trabajos, requiere_verificacion_extra) VALUES
  ('Zona 10',               'verde',    'Zona financiera y residencial premium',          TRUE,  FALSE),
  ('Zona 14',               'verde',    'Residencial exclusivo — sin restricciones',       TRUE,  FALSE),
  ('Zona 15',               'verde',    'Residencial seguro',                              TRUE,  FALSE),
  ('Zona 11',               'verde',    'Zona comercial activa',                           TRUE,  FALSE),
  ('Mixco',                 'amarillo', 'Requiere verificación de identidad',              TRUE,  TRUE),
  ('Santa Catarina Pinula', 'amarillo', 'Verificación recomendada',                        TRUE,  TRUE),
  ('Villa Nueva',           'rojo',     'Alto riesgo — cliente nuevo requiere revisión',   FALSE, TRUE),
  ('Otro departamento',     'amarillo', 'Fuera de área principal — verificar caso a caso', TRUE,  TRUE)
ON CONFLICT DO NOTHING;

-- 2. cliente_verificacion_identidad
CREATE TABLE IF NOT EXISTS cliente_verificacion_identidad (
  id                      BIGSERIAL PRIMARY KEY,
  cliente_id              BIGINT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  estado                  TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','verificado','rechazado')),
  dpi_numero              TEXT,
  dpi_imagen_url          TEXT,
  documento_foto_url      TEXT,
  selfie_vivo_url         TEXT,
  timestamp_captura       TIMESTAMPTZ DEFAULT NOW(),
  verificacion_biometrica BOOLEAN DEFAULT FALSE,
  razon_rechazo           TEXT,
  revisor_id              BIGINT REFERENCES usuarios(id),
  created_at              TIMESTAMPTZ DEFAULT NOW()
);

-- 3. propiedades — add zone/risk columns
ALTER TABLE propiedades
  ADD COLUMN IF NOT EXISTS zona_ubicacion TEXT,
  ADD COLUMN IF NOT EXISTS nivel_riesgo   TEXT CHECK (nivel_riesgo IN ('verde','amarillo','rojo'));

-- 4. cotizaciones — add multicanal columns
ALTER TABLE cotizaciones
  ADD COLUMN IF NOT EXISTS conversacion_id BIGINT,
  ADD COLUMN IF NOT EXISTS canal           TEXT CHECK (canal IN ('whatsapp','instagram','facebook','web')),
  ADD COLUMN IF NOT EXISTS tipo_servicio   TEXT,
  ADD COLUMN IF NOT EXISTS detalles_json   JSONB,
  ADD COLUMN IF NOT EXISTS moneda          TEXT DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS fecha_envio     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS metodo_envio    TEXT,
  ADD COLUMN IF NOT EXISTS documento_url   TEXT;

-- 5. instrucciones_ia_dinamicas
CREATE TABLE IF NOT EXISTS instrucciones_ia_dinamicas (
  id             BIGSERIAL PRIMARY KEY,
  tipo           TEXT NOT NULL CHECK (tipo IN ('respuesta_personalizada','politica','faq')),
  trigger        TEXT NOT NULL,
  contenido      TEXT NOT NULL,
  creada_por     BIGINT REFERENCES usuarios(id),
  fecha_creacion TIMESTAMPTZ DEFAULT NOW(),
  activa         BOOLEAN NOT NULL DEFAULT TRUE
);

-- 6. notificaciones_admin
CREATE TABLE IF NOT EXISTS notificaciones_admin (
  id                  BIGSERIAL PRIMARY KEY,
  tipo                TEXT NOT NULL CHECK (tipo IN ('verificacion_pendiente','cotizacion_revision','cliente_riesgo','zona_roja')),
  referencia_id       BIGINT,
  contenido           TEXT NOT NULL,
  timestamp           TIMESTAMPTZ DEFAULT NOW(),
  estado              TEXT NOT NULL DEFAULT 'enviada' CHECK (estado IN ('enviada','respondida')),
  respuesta_admin     TEXT,
  timestamp_respuesta TIMESTAMPTZ
);

-- 7. conversaciones_multicanal
CREATE TABLE IF NOT EXISTS conversaciones_multicanal (
  id                    BIGSERIAL PRIMARY KEY,
  cliente_id            BIGINT REFERENCES clientes(id),
  agente_id             BIGINT REFERENCES usuarios(id),
  canal                 TEXT NOT NULL CHECK (canal IN ('whatsapp','instagram','facebook','web')),
  estado                TEXT NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa','cerrada')),
  ultima_respuesta_tipo TEXT CHECK (ultima_respuesta_tipo IN ('ia','agente_humano')),
  timestamp             TIMESTAMPTZ DEFAULT NOW(),
  creada_por_cliente    TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- 8. mensajes
CREATE TABLE IF NOT EXISTS mensajes (
  id               BIGSERIAL PRIMARY KEY,
  conversacion_id  BIGINT NOT NULL REFERENCES conversaciones_multicanal(id) ON DELETE CASCADE,
  remitente_tipo   TEXT NOT NULL CHECK (remitente_tipo IN ('cliente','ia','agente_humano')),
  contenido        TEXT NOT NULL,
  timestamp        TIMESTAMPTZ DEFAULT NOW(),
  metadata_json    JSONB
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_mensajes_conv     ON mensajes(conversacion_id);
CREATE INDEX IF NOT EXISTS idx_conv_estado       ON conversaciones_multicanal(estado);
CREATE INDEX IF NOT EXISTS idx_conv_cliente      ON conversaciones_multicanal(cliente_id);
CREATE INDEX IF NOT EXISTS idx_conv_agente       ON conversaciones_multicanal(agente_id);
CREATE INDEX IF NOT EXISTS idx_verif_cliente     ON cliente_verificacion_identidad(cliente_id);
CREATE INDEX IF NOT EXISTS idx_notif_estado      ON notificaciones_admin(estado);
CREATE INDEX IF NOT EXISTS idx_instruc_activa    ON instrucciones_ia_dinamicas(activa);
