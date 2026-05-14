-- Migration 008: Tablas para el Agente IA de Marketing / Redes Sociales

CREATE TABLE IF NOT EXISTS brand_identity (
  id                BIGSERIAL PRIMARY KEY,
  business_id       TEXT NOT NULL UNIQUE,
  logo_url          TEXT,
  color_primary     TEXT DEFAULT '#2D5016',
  color_secondary   TEXT DEFAULT '#B8860B',
  color_accent      TEXT,
  brand_guidelines  TEXT,
  reference_images  JSONB DEFAULT '[]',
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS global_instructions (
  id                   BIGSERIAL PRIMARY KEY,
  business_id          TEXT NOT NULL UNIQUE,
  tone                 TEXT DEFAULT 'profesional',
  hashtags             JSONB DEFAULT '["#inmobiliarioGuatemala","#virtualestate","#Guatemala"]',
  required_cta         TEXT DEFAULT 'Contáctanos por WhatsApp',
  min_posts_per_week   INTEGER DEFAULT 5,
  publish_times        JSONB DEFAULT '["09:00","13:00","18:00"]',
  avoid_topics         TEXT,
  extra_instructions   TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pending_orders (
  id                BIGSERIAL PRIMARY KEY,
  business_id       TEXT NOT NULL,
  instruction       TEXT NOT NULL,
  focus_theme       TEXT,
  reference_images  JSONB DEFAULT '[]',
  priority          INTEGER DEFAULT 1,
  start_date        DATE,
  end_date          DATE,
  status            TEXT DEFAULT 'active' CHECK (status IN ('active','completed','cancelled')),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS generated_posts (
  id                   BIGSERIAL PRIMARY KEY,
  business_id          TEXT NOT NULL,
  content              TEXT,
  image_url            TEXT,
  image_description    TEXT,
  instagram_caption    TEXT,
  facebook_caption     TEXT,
  hashtags             JSONB DEFAULT '[]',
  theme                TEXT,
  source               TEXT DEFAULT 'auto',
  status               TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','published')),
  approval_notes       TEXT,
  approved_at          TIMESTAMPTZ,
  instagram_post_id    TEXT,
  published_at         TIMESTAMPTZ,
  scheduled_time       TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- Seed inicial Virtual Estate GT
INSERT INTO brand_identity (business_id, color_primary, color_secondary, color_accent, brand_guidelines)
VALUES (
  'virtual-estate', '#2D5016', '#B8860B', '#FFFFFF',
  'Marca profesional y elegante. Servicios de escaneo 3D, fotografía inmobiliaria y documentación técnica en Guatemala. Tono sofisticado, confiable y moderno.'
) ON CONFLICT (business_id) DO NOTHING;

INSERT INTO global_instructions (business_id, tone, hashtags, required_cta, min_posts_per_week, publish_times)
VALUES (
  'virtual-estate', 'profesional y cercano',
  '["#VirtualEstateGT","#InmobiliariaGuatemala","#Escaneo3D","#TourVirtual","#Matterport","#AsBuilt","#Guatemala","#PropiedadesGT"]',
  'Escríbenos por WhatsApp para más información', 5,
  '["09:00","13:00","18:00"]'
) ON CONFLICT (business_id) DO NOTHING;

-- RLS
ALTER TABLE brand_identity      ENABLE ROW LEVEL SECURITY;
ALTER TABLE global_instructions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE generated_posts     ENABLE ROW LEVEL SECURITY;
