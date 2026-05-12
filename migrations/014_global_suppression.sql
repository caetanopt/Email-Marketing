-- Make suppression list global (shared across all brands)

-- Make brand_id nullable
ALTER TABLE suppression ALTER COLUMN brand_id DROP NOT NULL;

-- Remove old unique constraint on (brand_id, email)
ALTER TABLE suppression DROP CONSTRAINT IF EXISTS suppression_brand_id_email_key;

-- Deduplicate: keep the oldest entry per email, delete newer duplicates
DELETE FROM suppression a
USING suppression b
WHERE a.email = b.email AND a.id > b.id;

-- Add new global unique constraint on email only
ALTER TABLE suppression ADD CONSTRAINT suppression_email_key UNIQUE (email);

-- Set existing brand_id values to NULL (now irrelevant)
UPDATE suppression SET brand_id = NULL WHERE brand_id IS NOT NULL;
