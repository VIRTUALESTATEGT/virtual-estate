-- Migration 009: Gestión de imágenes para el Agente IA de Marketing

-- Galería de imágenes de marca
CREATE TABLE IF NOT EXISTS brand_images (
  id                  BIGSERIAL PRIMARY KEY,
  business_id         TEXT NOT NULL,
  image_url           TEXT NOT NULL,
  image_description   TEXT,
  category            TEXT DEFAULT 'general',
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Referencias visuales (fotos para inspirarse)
CREATE TABLE IF NOT EXISTS image_references (
  id                      BIGSERIAL PRIMARY KEY,
  business_id             TEXT NOT NULL,
  image_url               TEXT NOT NULL,
  reference_description   TEXT,
  what_to_copy            TEXT,
  category                TEXT DEFAULT 'general',
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE brand_images      ENABLE ROW LEVEL SECURITY;
ALTER TABLE image_references  ENABLE ROW LEVEL SECURITY;
