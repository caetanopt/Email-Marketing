-- Migration 012: Imports history
-- Records each contact import (CSV/TXT) so users can audit what was loaded
-- and into which list, with success / skipped / failed counts.
CREATE TABLE IF NOT EXISTS imports (
    id SERIAL PRIMARY KEY,
    brand_id   TEXT    NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    file_name  TEXT    NOT NULL,
    list_id    INTEGER REFERENCES lists(id) ON DELETE SET NULL,
    list_name  TEXT,
    total_rows INTEGER NOT NULL DEFAULT 0,
    imported   INTEGER NOT NULL DEFAULT 0,
    skipped    INTEGER NOT NULL DEFAULT 0,
    failed     INTEGER NOT NULL DEFAULT 0,
    status     TEXT    NOT NULL DEFAULT 'completed', -- completed | partial | failed
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_imports_brand ON imports(brand_id, created_at DESC);
