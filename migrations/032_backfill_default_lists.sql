-- Backfill: ensure every brand has the two default contact lists.
-- Safe to re-run (ON CONFLICT DO NOTHING).

INSERT INTO lists (brand_id, name, description)
SELECT b.id, 'Marketing', 'Lista principal de marketing'
FROM brands b
WHERE b.active = TRUE
ON CONFLICT (brand_id, name) DO NOTHING;

INSERT INTO lists (brand_id, name, description)
SELECT b.id, 'Colaboradores', 'Lista de colaboradores internos'
FROM brands b
WHERE b.active = TRUE
ON CONFLICT (brand_id, name) DO NOTHING;
