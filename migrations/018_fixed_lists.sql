-- Create the two fixed lists (Marketing + Colaboradores) for every brand
-- Uses a unique constraint on (brand_id, name) to avoid duplicates
ALTER TABLE lists ADD CONSTRAINT IF NOT EXISTS lists_brand_name_unique UNIQUE (brand_id, name);

INSERT INTO lists (brand_id, name, description)
SELECT id, 'Marketing', 'Lista principal de marketing'
FROM brands
ON CONFLICT (brand_id, name) DO NOTHING;

INSERT INTO lists (brand_id, name, description)
SELECT id, 'Colaboradores', 'Lista de colaboradores internos'
FROM brands
ON CONFLICT (brand_id, name) DO NOTHING;

-- Mark contacts already in suppression as suppressed/unsubscribed
UPDATE contacts c
SET status = CASE
  WHEN s.reason = 'unsubscribe' THEN 'unsubscribed'
  ELSE 'suppressed'
END
FROM suppression s
WHERE c.email = s.email AND c.status = 'active';
