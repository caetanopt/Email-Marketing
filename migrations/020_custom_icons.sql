-- 020_custom_icons.sql
-- Ícones personalizados por marca ou globais

CREATE TABLE IF NOT EXISTS custom_icons (
  id          SERIAL PRIMARY KEY,
  brand_id    INTEGER REFERENCES brands(id) ON DELETE CASCADE,  -- NULL = global
  name        VARCHAR(255) NOT NULL,
  mime_type   VARCHAR(100) NOT NULL DEFAULT 'image/svg+xml',
  data_url    TEXT        NOT NULL,
  created_by  INTEGER REFERENCES users(id),
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_custom_icons_brand  ON custom_icons(brand_id);
CREATE INDEX IF NOT EXISTS idx_custom_icons_global ON custom_icons((brand_id IS NULL)) WHERE brand_id IS NULL;
