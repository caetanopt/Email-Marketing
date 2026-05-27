-- Rename 'twitter' key to 'tiktok' in brands.variables JSON for all brands
-- that have a twitter entry (preserves the URL value)
UPDATE brands
SET variables = (variables - 'twitter') || jsonb_build_object('tiktok', variables->>'twitter')
WHERE variables ? 'twitter';
