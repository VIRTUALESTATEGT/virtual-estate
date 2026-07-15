-- Tabla para tokens de recuperación de contraseña
CREATE TABLE IF NOT EXISTS password_resets (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id  integer     NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  email       text        NOT NULL,
  token       text        UNIQUE NOT NULL,
  expira_en   timestamptz NOT NULL,
  usado       boolean     NOT NULL DEFAULT false,
  creado_en   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets (token);

ALTER TABLE password_resets ENABLE ROW LEVEL SECURITY;
