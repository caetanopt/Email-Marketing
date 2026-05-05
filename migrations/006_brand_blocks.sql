-- Migration 006: Add header_html and footer_html blocks per brand
ALTER TABLE brands ADD COLUMN IF NOT EXISTS header_html TEXT;
ALTER TABLE brands ADD COLUMN IF NOT EXISTS footer_html TEXT;
