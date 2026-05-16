-- Migration 010: Vincular imagen de marca a posts generados

ALTER TABLE generated_posts ADD COLUMN IF NOT EXISTS image_id BIGINT;
ALTER TABLE generated_posts ADD CONSTRAINT fk_image
  FOREIGN KEY (image_id) REFERENCES brand_images(id) ON DELETE SET NULL;
