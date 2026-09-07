-- Desvincula os contactos das marcas: um email passa a ser uma pessoa só.
--
-- As listas de email são globais (037, e a 049 tirou-lhes o brand_id). Os
-- contactos ficaram por marca: contacts.brand_id NOT NULL, único
-- (brand_id, email) e ON DELETE CASCADE para brands. Isso significava três
-- coisas más:
--
--   1. A mesma pessoa era vários contactos — um por cada marca em que estava.
--      O envio já as tratava como uma só (junta-as com
--      DISTINCT ON (lower(email))), mas o estado não: cancelar a subscrição
--      num contacto deixava os outros activos.
--   2. Apagar uma marca apagava os contactos que lhe estavam atribuídos, e com
--      eles a subscrição nas listas globais — para todas as marcas.
--   3. A API obrigava a indicar uma marca para criar um contacto, quando as
--      listas onde ele entra não pertencem a nenhuma.
--
-- ATENÇÃO: esta migração APAGA linhas da tabela contacts — os duplicados do
-- mesmo email, depois de lhes transferir as listas, os destinatários de
-- campanhas e os eventos para o contacto que fica. Corre primeiro a consulta
-- do passo 0 para ver exactamente o que vai ser fundido.
--
-- Para cada email fica o contacto com o id mais baixo (o mais antigo), que é o
-- que as campanhas antigas referenciam.
--
-- Nota sobre a forma do ficheiro: o mapa dos duplicados é recalculado em cada
-- instrução em vez de ficar numa tabela temporária. Fica mais repetitivo, mas
-- as tabelas temporárias não sobrevivem entre instruções no editor de SQL do
-- Supabase (cada uma pode correr noutra ligação), e o mapa dá sempre o mesmo
-- resultado porque a tabela contacts só é alterada no fim, no passo 6.

-- ───────────────────────────────────────────────────────────────────────────
-- Passo 0 — só para ver (não altera nada). Podes correr isto sozinho.
-- ───────────────────────────────────────────────────────────────────────────
--   SELECT LOWER(email) AS email,
--          COUNT(*) AS quantos,
--          MIN(id) AS fica_o_id,
--          ARRAY_AGG(brand_id ORDER BY id) AS marcas
--   FROM contacts
--   GROUP BY LOWER(email)
--   HAVING COUNT(*) > 1
--   ORDER BY 2 DESC, 1;

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- Passo 1 — o contacto que fica herda o estado dos duplicados
--
-- Se algum dos duplicados tinha cancelado a subscrição (ou foi
-- devolvido/suprimido), o contacto que fica passa a cancelado. Uma fusão
-- nunca pode reactivar quem pediu para sair.
-- ───────────────────────────────────────────────────────────────────────────
UPDATE contacts SET status = 'unsubscribed', updated_at = NOW()
WHERE status = 'active'
  AND id IN (
    SELECT k.fica
    FROM contacts d
    JOIN (
      SELECT LOWER(email) AS chave, MIN(id) AS fica
      FROM contacts GROUP BY LOWER(email) HAVING COUNT(*) > 1
    ) k ON k.chave = LOWER(d.email)
    WHERE d.id <> k.fica
      AND d.status::text IN ('unsubscribed','bounced','suppressed','complained')
  );

-- ───────────────────────────────────────────────────────────────────────────
-- Passo 2 — e herda os campos que tinha vazios
--
-- Nome, telefone e empresa, mais a data de subscrição mais antiga, que é a que
-- representa quando a pessoa se inscreveu de facto.
-- ───────────────────────────────────────────────────────────────────────────
UPDATE contacts c
   SET name       = COALESCE(c.name, agg.nome),
       phone      = COALESCE(c.phone, agg.telefone),
       company    = COALESCE(c.company, agg.empresa),
       created_at = LEAST(c.created_at, agg.mais_antiga),
       updated_at = NOW()
FROM (
  SELECT k.fica,
         MIN(d.name)       AS nome,
         MIN(d.phone)      AS telefone,
         MIN(d.company)    AS empresa,
         MIN(d.created_at) AS mais_antiga
  FROM contacts d
  JOIN (
    SELECT LOWER(email) AS chave, MIN(id) AS fica
    FROM contacts GROUP BY LOWER(email) HAVING COUNT(*) > 1
  ) k ON k.chave = LOWER(d.email)
  WHERE d.id <> k.fica
  GROUP BY k.fica
) agg
WHERE c.id = agg.fica;

-- ───────────────────────────────────────────────────────────────────────────
-- Passo 3 — subscrições nas listas passam para o contacto que fica
--
-- A chave primária de list_members é (list_id, contact_id): se o contacto que
-- fica já estiver na lista, não é duplicado.
-- ───────────────────────────────────────────────────────────────────────────
INSERT INTO list_members (list_id, contact_id, extra_data, added_at)
SELECT lm.list_id, mapa.fica, lm.extra_data, lm.added_at
FROM list_members lm
JOIN (
  SELECT d.id AS antigo, k.fica
  FROM contacts d
  JOIN (
    SELECT LOWER(email) AS chave, MIN(id) AS fica
    FROM contacts GROUP BY LOWER(email) HAVING COUNT(*) > 1
  ) k ON k.chave = LOWER(d.email)
  WHERE d.id <> k.fica
) mapa ON mapa.antigo = lm.contact_id
ON CONFLICT (list_id, contact_id) DO NOTHING;

-- Se a pessoa estava na mesma lista pelos dois contactos, fica a data de
-- subscrição mais antiga e os campos extra que faltavam.
UPDATE list_members k
   SET added_at   = LEAST(k.added_at, origem.mais_antiga),
       extra_data = COALESCE(k.extra_data, origem.extra_data)
FROM (
  SELECT lm.list_id, mapa.fica,
         MIN(lm.added_at) AS mais_antiga,
         MIN(lm.extra_data::text)::jsonb AS extra_data
  FROM list_members lm
  JOIN (
    SELECT d.id AS antigo, k2.fica
    FROM contacts d
    JOIN (
      SELECT LOWER(email) AS chave, MIN(id) AS fica
      FROM contacts GROUP BY LOWER(email) HAVING COUNT(*) > 1
    ) k2 ON k2.chave = LOWER(d.email)
    WHERE d.id <> k2.fica
  ) mapa ON mapa.antigo = lm.contact_id
  GROUP BY lm.list_id, mapa.fica
) origem
WHERE k.list_id = origem.list_id
  AND k.contact_id = origem.fica
  AND origem.mais_antiga IS NOT NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- Passo 4 — destinatários das campanhas
--
-- campaign_recipients é único por (campaign_id, contact_id). Se a mesma
-- pessoa ficou como destinatária duas vezes na mesma campanha — uma por cada
-- contacto duplicado — fica uma linha só: a que tem registo de envio.
-- ───────────────────────────────────────────────────────────────────────────
WITH mapa AS (
  SELECT d.id AS antigo, k.fica
  FROM contacts d
  JOIN (
    SELECT LOWER(email) AS chave, MIN(id) AS fica
    FROM contacts GROUP BY LOWER(email) HAVING COUNT(*) > 1
  ) k ON k.chave = LOWER(d.email)
  WHERE d.id <> k.fica
),
envolvidos AS (
  SELECT cr.id, cr.campaign_id,
         COALESCE(m.fica, cr.contact_id) AS fica,
         (cr.status::text = 'sent') AS enviado
  FROM campaign_recipients cr
  LEFT JOIN mapa m ON m.antigo = cr.contact_id
  WHERE cr.contact_id IN (SELECT antigo FROM mapa)
     OR cr.contact_id IN (SELECT fica FROM mapa)
),
fica_uma AS (
  SELECT DISTINCT ON (campaign_id, fica) id
  FROM envolvidos
  ORDER BY campaign_id, fica, enviado DESC, id
)
DELETE FROM campaign_recipients
WHERE id IN (SELECT id FROM envolvidos)
  AND id NOT IN (SELECT id FROM fica_uma);

UPDATE campaign_recipients cr
   SET contact_id = mapa.fica
FROM (
  SELECT d.id AS antigo, k.fica
  FROM contacts d
  JOIN (
    SELECT LOWER(email) AS chave, MIN(id) AS fica
    FROM contacts GROUP BY LOWER(email) HAVING COUNT(*) > 1
  ) k ON k.chave = LOWER(d.email)
  WHERE d.id <> k.fica
) mapa
WHERE mapa.antigo = cr.contact_id;

-- ───────────────────────────────────────────────────────────────────────────
-- Passo 5 — eventos e registo de envios (aberturas, cliques, cancelamentos)
-- ───────────────────────────────────────────────────────────────────────────
UPDATE email_events e
   SET contact_id = mapa.fica
FROM (
  SELECT d.id AS antigo, k.fica
  FROM contacts d
  JOIN (
    SELECT LOWER(email) AS chave, MIN(id) AS fica
    FROM contacts GROUP BY LOWER(email) HAVING COUNT(*) > 1
  ) k ON k.chave = LOWER(d.email)
  WHERE d.id <> k.fica
) mapa
WHERE mapa.antigo = e.contact_id;

UPDATE email_send_log l
   SET contact_id = mapa.fica
FROM (
  SELECT d.id AS antigo, k.fica
  FROM contacts d
  JOIN (
    SELECT LOWER(email) AS chave, MIN(id) AS fica
    FROM contacts GROUP BY LOWER(email) HAVING COUNT(*) > 1
  ) k ON k.chave = LOWER(d.email)
  WHERE d.id <> k.fica
) mapa
WHERE mapa.antigo = l.contact_id;

-- ───────────────────────────────────────────────────────────────────────────
-- Passo 6 — apagar os contactos duplicados
--
-- Já não sobra nada apontado para eles: as listas e os destinatários foram
-- transferidos nos passos 3 e 4, os eventos no 5.
-- ───────────────────────────────────────────────────────────────────────────
DELETE FROM contacts
WHERE id IN (
  SELECT d.id
  FROM contacts d
  JOIN (
    SELECT LOWER(email) AS chave, MIN(id) AS fica
    FROM contacts GROUP BY LOWER(email) HAVING COUNT(*) > 1
  ) k ON k.chave = LOWER(d.email)
  WHERE d.id <> k.fica
);

-- ───────────────────────────────────────────────────────────────────────────
-- Passo 7 — a coluna sai, e com ela o CASCADE que apagava contactos ao
-- apagar uma marca
--
-- Apagar a coluna leva com ela a chave estrangeira para brands, a unicidade
-- (brand_id, email) e o índice idx_contacts_brand_status.
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE contacts ALTER COLUMN brand_id DROP NOT NULL;
DROP INDEX IF EXISTS idx_contacts_brand_status;
ALTER TABLE contacts DROP COLUMN IF EXISTS brand_id;

-- A API grava sempre em minúsculas, mas dados antigos podem ter maiúsculas —
-- e o índice único é sobre LOWER(email).
UPDATE contacts SET email = LOWER(email) WHERE email <> LOWER(email);

-- O que substitui a unicidade (brand_id, email): um email, um contacto.
CREATE UNIQUE INDEX IF NOT EXISTS contacts_email_unique_ci ON contacts (LOWER(email));

-- Passa a ser o estado que filtra as listagens, já sem a marca à frente.
CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts (status);

COMMIT;

-- ───────────────────────────────────────────────────────────────────────────
-- Verificação — não pode sobrar nenhum email repetido
-- ───────────────────────────────────────────────────────────────────────────
SELECT COUNT(*)::int AS contactos,
       COUNT(DISTINCT LOWER(email))::int AS emails_distintos,
       COUNT(*) FILTER (WHERE status = 'active')::int AS activos
FROM contacts;
