-- Funde listas com o mesmo nome e cria o índice único que faltava.
--
-- A migração 049 tirou o brand_id às listas, e com ele foi-se o índice
-- lists_brand_name_unique (018), que era (brand_id, name). O índice de
-- substituição — único sobre LOWER(name) — não pôde ser criado porque já
-- existiam listas com o mesmo nome: eram permitidas desde que estivessem em
-- marcas diferentes, e ficaram todas no mesmo espaço quando as listas
-- passaram a ser globais.
--
-- ATENÇÃO: esta migração APAGA linhas da tabela lists — as duplicadas, depois
-- de lhes transferir os contactos, os segmentos e as associações a campanhas
-- para a lista que fica. Corre primeiro a consulta do passo 0 para ver
-- exactamente o que vai ser fundido.
--
-- Para cada nome repetido fica a lista com o id mais baixo (a mais antiga),
-- que é a que as campanhas antigas referenciam.
--
-- Tudo corre dentro de uma transacção: se qualquer passo falhar, nada é
-- aplicado.

-- ───────────────────────────────────────────────────────────────────────────
-- Passo 0 — só para ver (não altera nada). Podes correr isto sozinho.
-- ───────────────────────────────────────────────────────────────────────────
--   SELECT LOWER(l.name) AS nome,
--          COUNT(*) AS quantas,
--          MIN(l.id) AS fica_o_id,
--          ARRAY_AGG(l.id ORDER BY l.id) AS ids
--   FROM lists l
--   GROUP BY LOWER(l.name)
--   HAVING COUNT(*) > 1
--   ORDER BY 1;

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- Passo 1 — contactos das duplicadas passam para a lista que fica
--
-- A chave primária de list_members é (list_id, contact_id): um contacto que
-- já esteja na lista que fica não é duplicado.
-- ───────────────────────────────────────────────────────────────────────────
INSERT INTO list_members (list_id, contact_id, extra_data, added_at)
SELECT dup.fica, lm.contact_id, lm.extra_data, lm.added_at
FROM list_members lm
JOIN (
  SELECT l.id AS antiga, c.fica
  FROM lists l
  JOIN (
    SELECT LOWER(name) AS chave, MIN(id) AS fica
    FROM lists GROUP BY LOWER(name) HAVING COUNT(*) > 1
  ) c ON c.chave = LOWER(l.name)
  WHERE l.id <> c.fica
) dup ON dup.antiga = lm.list_id
ON CONFLICT (list_id, contact_id) DO NOTHING;

-- Se o mesmo contacto estava nas duas listas com datas de subscrição
-- diferentes, fica a mais antiga — é a data em que a pessoa se inscreveu de
-- facto, e é o que a coluna "Subscrito em" deve mostrar.
UPDATE list_members k
   SET added_at = origem.mais_antiga
FROM (
  SELECT c.fica AS list_id, lm.contact_id, MIN(lm.added_at) AS mais_antiga
  FROM list_members lm
  JOIN lists l ON l.id = lm.list_id
  JOIN (
    SELECT LOWER(name) AS chave, MIN(id) AS fica
    FROM lists GROUP BY LOWER(name) HAVING COUNT(*) > 1
  ) c ON c.chave = LOWER(l.name)
  GROUP BY c.fica, lm.contact_id
) origem
WHERE k.list_id = origem.list_id
  AND k.contact_id = origem.contact_id
  AND origem.mais_antiga IS NOT NULL
  AND (k.added_at IS NULL OR k.added_at > origem.mais_antiga);

-- ───────────────────────────────────────────────────────────────────────────
-- Passo 2 — segmentos e campanhas passam a apontar para a lista que fica
-- ───────────────────────────────────────────────────────────────────────────
UPDATE segments s
   SET list_id = dup.fica
FROM (
  SELECT l.id AS antiga, c.fica
  FROM lists l
  JOIN (
    SELECT LOWER(name) AS chave, MIN(id) AS fica
    FROM lists GROUP BY LOWER(name) HAVING COUNT(*) > 1
  ) c ON c.chave = LOWER(l.name)
  WHERE l.id <> c.fica
) dup
WHERE s.list_id = dup.antiga;

INSERT INTO campaign_lists (campaign_id, list_id)
SELECT cl.campaign_id, dup.fica
FROM campaign_lists cl
JOIN (
  SELECT l.id AS antiga, c.fica
  FROM lists l
  JOIN (
    SELECT LOWER(name) AS chave, MIN(id) AS fica
    FROM lists GROUP BY LOWER(name) HAVING COUNT(*) > 1
  ) c ON c.chave = LOWER(l.name)
  WHERE l.id <> c.fica
) dup ON dup.antiga = cl.list_id
ON CONFLICT DO NOTHING;

-- ───────────────────────────────────────────────────────────────────────────
-- Passo 3 — apagar as listas duplicadas
--
-- list_members e campaign_lists têm ON DELETE CASCADE para lists, por isso as
-- linhas que sobram nas duplicadas desaparecem com elas. O conteúdo já foi
-- transferido nos passos 1 e 2.
-- ───────────────────────────────────────────────────────────────────────────
DELETE FROM lists
WHERE id IN (
  SELECT l.id
  FROM lists l
  JOIN (
    SELECT LOWER(name) AS chave, MIN(id) AS fica
    FROM lists GROUP BY LOWER(name) HAVING COUNT(*) > 1
  ) c ON c.chave = LOWER(l.name)
  WHERE l.id <> c.fica
);

-- ───────────────────────────────────────────────────────────────────────────
-- Passo 4 — o índice único que a 049 não conseguiu criar
-- ───────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS lists_name_unique_ci ON lists (LOWER(name));

COMMIT;

-- ───────────────────────────────────────────────────────────────────────────
-- Verificação — não pode sobrar nenhum nome repetido
-- ───────────────────────────────────────────────────────────────────────────
SELECT l.id, l.name,
       (SELECT COUNT(*) FROM list_members m WHERE m.list_id = l.id) AS contactos
FROM lists l ORDER BY l.id;
