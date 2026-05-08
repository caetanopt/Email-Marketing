-- Migration 010: Per-member area permissions
-- An empty row-set for a (user, brand) pair means FULL access (default for any
-- user_brand_roles row). Inserting rows here narrows the access to only the
-- listed areas, e.g. dashboard, contacts, lists, campaigns, blocks, media,
-- imports, suppression, team, brandSettings.
CREATE TABLE IF NOT EXISTS user_brand_areas (
    user_id  INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    brand_id TEXT    NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    area     TEXT    NOT NULL,
    PRIMARY KEY (user_id, brand_id, area)
);
CREATE INDEX IF NOT EXISTS idx_user_brand_areas_user_brand ON user_brand_areas(user_id, brand_id);
