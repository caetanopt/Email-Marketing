-- Add template variables storage to brands
ALTER TABLE brands ADD COLUMN IF NOT EXISTS variables JSONB;
