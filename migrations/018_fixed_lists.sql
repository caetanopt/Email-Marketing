-- Unique index to prevent duplicate list names per brand
CREATE UNIQUE INDEX IF NOT EXISTS lists_brand_name_unique ON lists(brand_id, name);

-- Create the two fixed lists for every brand
INSERT INTO lists (brand_id, name, description)
SELECT id, 'Marketing', 'Lista principal de marketing'
FROM brands
ON CONFLICT DO NOTHING;

INSERT INTO lists (brand_id, name, description)
SELECT id, 'Colaboradores', 'Lista de colaboradores internos'
FROM brands
ON CONFLICT DO NOTHING;

-- Mark contacts already in suppression as suppressed/unsubscribed
UPDATE contacts c
SET status = (CASE
  WHEN s.reason = 'unsubscribe' THEN 'unsubscribed'
  ELSE 'suppressed'
END)::contact_status
FROM suppression s
WHERE c.email = s.email AND c.status = 'active';
