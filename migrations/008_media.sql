-- Migration 008: Media library (per-brand with optional sharing across brands)
-- A media item belongs to a brand (creator). When is_shared=TRUE the item is
-- visible from every brand's media library. brand_id is kept so we know who
-- owns the asset and to allow re-scoping if sharing is later turned off.

CREATE TABLE IF NOT EXISTS media (
    id SERIAL PRIMARY KEY,
    brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    mime_type TEXT,
    is_shared BOOLEAN NOT NULL DEFAULT FALSE,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_brand ON media(brand_id);
CREATE INDEX IF NOT EXISTS idx_media_shared ON media(is_shared);
