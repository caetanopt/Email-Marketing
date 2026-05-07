-- Migration 007: Multi-version brand blocks (headers and footers)
-- Each brand can have multiple named header and footer blocks. Campaign wizard
-- lets the user pick which one to insert.

CREATE TABLE IF NOT EXISTS brand_blocks (
    id SERIAL PRIMARY KEY,
    brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('header','footer')),
    name TEXT NOT NULL,
    html_content TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_brand_blocks_brand_type ON brand_blocks(brand_id, type);
