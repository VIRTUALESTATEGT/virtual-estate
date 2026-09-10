-- 070_config_sitio.sql
-- Tabla de configuración del sitio (clave/valor). Idempotente.

CREATE TABLE IF NOT EXISTS config_sitio (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL DEFAULT ''
);

-- Seed inicial: URL de demo del recorrido virtual (Matterport)
INSERT INTO config_sitio (clave, valor)
VALUES ('tour_demo_url', 'https://my.matterport.com/show/?m=rjwe8kD4441&brand=0&help=0&title=0&qs=1')
ON CONFLICT (clave) DO NOTHING;
