-- Listas globais: passa a existir UMA lista 'Marketing' e UMA 'Colaboradores'
-- partilhadas por todas as marcas. Membros, segmentos e associações de campanhas
-- das listas duplicadas (por marca) são fundidos nas listas canónicas.
-- Segmentos ganham brand_id — só aparecem na marca onde foram criados.

DO $migration$
DECLARE
  v_default_brand TEXT;
BEGIN

-- 1) Segmentos: coluna brand_id, backfill a partir da marca da lista actual
ALTER TABLE segments ADD COLUMN IF NOT EXISTS brand_id TEXT REFERENCES brands(id) ON DELETE CASCADE;
UPDATE segments s SET brand_id = l.brand_id
FROM lists l WHERE l.id = s.list_id AND s.brand_id IS NULL;

-- 2) Garantir que as listas canónicas existem
SELECT id INTO v_default_brand FROM brands WHERE active = TRUE ORDER BY id LIMIT 1;

INSERT INTO lists (brand_id, name, description)
SELECT v_default_brand, v.name, v.descr
FROM (VALUES ('Marketing','Lista principal de marketing'),
             ('Colaboradores','Lista de colaboradores internos')) AS v(name, descr)
WHERE NOT EXISTS (SELECT 1 FROM lists WHERE name = v.name);

-- 3) Fundir membros das listas duplicadas nas canónicas
--    (listas não-canónicas = mesmas nomes mas id > mínimo)
INSERT INTO list_members (list_id, contact_id, extra_data)
SELECT canon.keep_id, lm.contact_id, lm.extra_data
FROM list_members lm
JOIN lists l ON l.id = lm.list_id
JOIN (
  SELECT name, MIN(id) AS keep_id FROM lists
  WHERE name IN ('Marketing','Colaboradores') GROUP BY name
) canon ON canon.name = l.name
WHERE lm.list_id != canon.keep_id
ON CONFLICT (list_id, contact_id) DO NOTHING;

-- 4) Re-apontar segmentos para a lista canónica
UPDATE segments s SET list_id = canon.keep_id
FROM lists l
JOIN (
  SELECT name, MIN(id) AS keep_id FROM lists
  WHERE name IN ('Marketing','Colaboradores') GROUP BY name
) canon ON canon.name = l.name
WHERE s.list_id = l.id AND l.id != canon.keep_id;

-- 5) Re-apontar campaign_lists para a lista canónica
INSERT INTO campaign_lists (campaign_id, list_id)
SELECT cl.campaign_id, canon.keep_id
FROM campaign_lists cl
JOIN lists l ON l.id = cl.list_id
JOIN (
  SELECT name, MIN(id) AS keep_id FROM lists
  WHERE name IN ('Marketing','Colaboradores') GROUP BY name
) canon ON canon.name = l.name
WHERE cl.list_id != canon.keep_id
ON CONFLICT DO NOTHING;

DELETE FROM campaign_lists
WHERE list_id IN (
  SELECT l.id FROM lists l
  JOIN (
    SELECT name, MIN(id) AS keep_id FROM lists
    WHERE name IN ('Marketing','Colaboradores') GROUP BY name
  ) canon ON canon.name = l.name
  WHERE l.id != canon.keep_id
);

-- 6) Apagar listas não-canónicas com nomes conhecidos
--    e listas com outros nomes (não-Marketing/Colaboradores)
DELETE FROM lists
WHERE name IN ('Marketing','Colaboradores')
  AND id NOT IN (
    SELECT MIN(id) FROM lists
    WHERE name IN ('Marketing','Colaboradores') GROUP BY name
  );

-- Listas com outros nomes: re-apontar membros/segmentos/campanhas para Marketing
INSERT INTO list_members (list_id, contact_id, extra_data)
SELECT (SELECT MIN(id) FROM lists WHERE name='Marketing'), lm.contact_id, lm.extra_data
FROM list_members lm
WHERE lm.list_id NOT IN (SELECT id FROM lists WHERE name IN ('Marketing','Colaboradores'))
ON CONFLICT (list_id, contact_id) DO NOTHING;

UPDATE segments SET list_id = (SELECT MIN(id) FROM lists WHERE name='Marketing')
WHERE list_id NOT IN (SELECT id FROM lists WHERE name IN ('Marketing','Colaboradores'));

INSERT INTO campaign_lists (campaign_id, list_id)
SELECT cl.campaign_id, (SELECT MIN(id) FROM lists WHERE name='Marketing')
FROM campaign_lists cl
WHERE cl.list_id NOT IN (SELECT id FROM lists WHERE name IN ('Marketing','Colaboradores'))
ON CONFLICT DO NOTHING;

DELETE FROM campaign_lists
WHERE list_id NOT IN (SELECT id FROM lists WHERE name IN ('Marketing','Colaboradores'));

DELETE FROM lists
WHERE name NOT IN ('Marketing','Colaboradores');

-- 7) Unicidade global por nome (substitui a unicidade por marca)
DROP INDEX IF EXISTS lists_brand_name_unique;
CREATE UNIQUE INDEX IF NOT EXISTS lists_name_unique ON lists(name);

END;
$migration$ LANGUAGE plpgsql;
