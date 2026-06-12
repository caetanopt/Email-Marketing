-- Listas globais: passa a existir UMA lista 'Marketing' e UMA 'Colaboradores'
-- partilhadas por todas as marcas. Membros, segmentos e associações de campanhas
-- das listas duplicadas (por marca) são fundidos nas listas canónicas.
-- Segmentos ganham brand_id — só aparecem na marca onde foram criados.

-- 1) Segmentos: coluna brand_id, backfill a partir da marca da lista actual
ALTER TABLE segments ADD COLUMN IF NOT EXISTS brand_id TEXT REFERENCES brands(id) ON DELETE CASCADE;
UPDATE segments s SET brand_id = l.brand_id
FROM lists l WHERE l.id = s.list_id AND s.brand_id IS NULL;

-- 2) Listas canónicas = menor id de cada nome (criadas pela migração 018/032)
CREATE TEMP TABLE canon AS
SELECT name, MIN(id) AS keep_id FROM lists
WHERE name IN ('Marketing','Colaboradores') GROUP BY name;

-- Garantir que existem (instalações novas)
INSERT INTO lists (brand_id, name, description)
SELECT (SELECT id FROM brands WHERE active = TRUE ORDER BY id LIMIT 1), v.name, v.descr
FROM (VALUES ('Marketing','Lista principal de marketing'),
             ('Colaboradores','Lista de colaboradores internos')) AS v(name, descr)
WHERE NOT EXISTS (SELECT 1 FROM canon c WHERE c.name = v.name);
INSERT INTO canon
SELECT name, MIN(id) FROM lists
WHERE name IN ('Marketing','Colaboradores')
  AND name NOT IN (SELECT name FROM canon)
GROUP BY name;

-- 3) Mapa de migração: cada lista não-canónica aponta para a canónica do mesmo
--    nome; listas com outros nomes vão para 'Marketing'
CREATE TEMP TABLE list_map AS
SELECT l.id AS old_id,
       COALESCE(c.keep_id, (SELECT keep_id FROM canon WHERE name='Marketing')) AS new_id
FROM lists l
LEFT JOIN canon c ON c.name = l.name
WHERE l.id NOT IN (SELECT keep_id FROM canon);

-- 4) Fundir membros (mantém extra_data; em conflito mantém o registo existente)
INSERT INTO list_members (list_id, contact_id, extra_data)
SELECT m.new_id, lm.contact_id, lm.extra_data
FROM list_members lm JOIN list_map m ON m.old_id = lm.list_id
ON CONFLICT (list_id, contact_id) DO NOTHING;

-- 5) Re-apontar segmentos e associações de campanhas
UPDATE segments s SET list_id = m.new_id
FROM list_map m WHERE s.list_id = m.old_id;

INSERT INTO campaign_lists (campaign_id, list_id)
SELECT cl.campaign_id, m.new_id
FROM campaign_lists cl JOIN list_map m ON m.old_id = cl.list_id
ON CONFLICT DO NOTHING;
DELETE FROM campaign_lists WHERE list_id IN (SELECT old_id FROM list_map);

-- 6) Apagar listas não-canónicas (membros já fundidos; FKs já re-apontados)
DELETE FROM lists WHERE id IN (SELECT old_id FROM list_map);

-- 7) Unicidade global por nome (substitui a unicidade por marca)
DROP INDEX IF EXISTS lists_brand_name_unique;
CREATE UNIQUE INDEX IF NOT EXISTS lists_name_unique ON lists(name);

DROP TABLE canon; DROP TABLE list_map;
