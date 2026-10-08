-- Cliques e aberturas de analisadores de segurança: ver, pré-visualizar e
-- corrigir campanhas já enviadas.
--
-- GERADO por lib/classificarCliques.js (gerarScript) — não editar à mão.
--
-- A migração 068 deu todas as campanhas já enviadas como revistas, por isso o
-- deploy não lhes mudou nenhum número. As novas são revistas sozinhas pelo
-- agendador (10 min depois de o envio terminar e 24 h depois). Para corrigir
-- uma antiga:
--
--   1. Passo 1 (só lê): ver como clicaram os contactos com vários links.
--   2. Passo 2: pré-visualizar o efeito nos números do relatório. Só mexe em
--      tabelas temporárias, que desaparecem no fim; não altera nada.
--   3. Passo 3 (altera): pôr a campanha na fila. O agendador revê-a no minuto
--      seguinte (até 5 por minuto), com as mesmas regras da pré-visualização.
--   4. Passo 4 (só lê): ver o que falta e o que ficou marcado.
--   5. Passo 5 (só lê): cliques que ainda contam de contactos com cliques
--      automáticos — se forem muitos, o analisador voltou sozinho mais tarde.
-- Desfazer: scripts/reverter-cliques-automaticos.sql.
--
-- Correr UM passo de cada vez: seleccionar o bloco do passo e carregar em Run
-- no editor de SQL do Supabase (que mostra o resultado da última instrução).
-- Os passos estão para a campanha 131: troca o número para ver outra.

-- ── 1. Diagnóstico (só lê) ─────────────────────────────────────────────────
WITH c AS (
  SELECT e.contact_id, e.url, e.user_agent, e.created_at,
         e.created_at - LAG(e.created_at) OVER (PARTITION BY e.contact_id ORDER BY e.created_at, e.id) AS pausa
    FROM email_events e
   WHERE e.campaign_id = 131 AND e.type::text IN ('click', 'click_auto') AND e.contact_id IS NOT NULL
)
SELECT c.contact_id,
       COUNT(DISTINCT c.url)                                               AS links,
       COUNT(*)                                                            AS cliques,
       ROUND(EXTRACT(EPOCH FROM MIN(c.created_at) - MIN(r.sent_at)))       AS seg_envio_ate_1o_clique,
       ROUND(EXTRACT(EPOCH FROM MAX(c.created_at) - MIN(c.created_at)), 1) AS duracao_seg,
       ROUND(EXTRACT(EPOCH FROM MAX(c.pausa)), 1)                          AS maior_pausa_seg,
       LEFT(MIN(c.user_agent), 70)                                         AS agente
  FROM c
  LEFT JOIN campaign_recipients r ON r.campaign_id = 131 AND r.contact_id = c.contact_id
 GROUP BY c.contact_id
HAVING COUNT(DISTINCT c.url) >= 2
 ORDER BY links DESC, duracao_seg;

-- ── 2. Pré-visualização (não altera nada) ─────────────────────────────────
-- Uma linha: quantos contactos seriam dados como automáticos, quantos cliques
-- e aberturas mudam, e os contactos únicos que clicaram e abriram, hoje e
-- depois (são os números do relatório).
CREATE TEMP TABLE _cc ON COMMIT DROP AS
SELECT e.id, e.contact_id, e.url, e.user_agent, e.created_at,
       floor(extract(epoch FROM e.created_at) / 5)::bigint AS balde
  FROM email_events e
 WHERE e.campaign_id = 131 AND e.contact_id IS NOT NULL
   AND (e.type = 'click' OR (e.type = 'click_auto' AND e.auto_reason IN ('rajada', 'varrimento', 'instantaneo')));

CREATE TEMP TABLE _cp ON COMMIT DROP AS
SELECT p.*, p.t = MIN(p.t) OVER (PARTITION BY p.contact_id, p.url) AS primeira_vez
  FROM (SELECT contact_id, url, balde, MIN(created_at) AS t,
               COALESCE(lower(split_part(split_part(url, '#', 1), '?', 1)) ~ '^https?://([a-z0-9-]+\.)*(facebook|instagram|linkedin|tiktok|twitter|x|pinterest)\.com(/|$)|^https?://([a-z0-9-]+\.)*youtube\.com/(?!(watch|shorts|embed|live|playlist)(/|$))|/v/[0-9]+/|/api/preview$|privacidade|privacy|rgpd', false) AS util
          FROM _cc
         GROUP BY contact_id, url, balde) p;

DELETE FROM _cp WHERE contact_id IN (SELECT contact_id FROM _cp GROUP BY contact_id HAVING COUNT(*) > 300);

CREATE INDEX ON _cp (contact_id, t);

ANALYZE _cp;

CREATE TEMP TABLE _cv ON COMMIT DROP AS
SELECT p.contact_id, p.url, p.balde, p.t, p.util, p.primeira_vez,
       COUNT(DISTINCT q.url) FILTER (WHERE q.t BETWEEN p.t - INTERVAL '1 second' AND p.t + INTERVAL '1 second') AS links_1s,
       COUNT(DISTINCT q.url) FILTER (WHERE q.t BETWEEN p.t - INTERVAL '60 seconds' AND p.t + INTERVAL '60 seconds') AS links_60s,
       COUNT(DISTINCT q.url) AS links_5min,
       COUNT(DISTINCT q.url) FILTER (WHERE q.util) AS util_5min
  FROM _cp p
  JOIN _cp q ON q.contact_id = p.contact_id
            AND q.t BETWEEN p.t - INTERVAL '5 minutes' AND p.t + INTERVAL '5 minutes'
 GROUP BY p.contact_id, p.url, p.balde, p.t, p.util, p.primeira_vez;

CREATE TEMP TABLE _cd ON COMMIT DROP AS
SELECT d.* FROM (
  SELECT v.contact_id, v.url, v.balde,
         CASE
           WHEN v.perto_rajada THEN 'rajada'
           WHEN v.links_5min >= 5 AND v.util_5min >= 2 AND v.perto_nucleo AND (v.util OR v.primeira_vez) THEN 'varrimento'
           WHEN r.sent_at IS NOT NULL AND v.t >= r.sent_at - INTERVAL '5 seconds'
                AND v.t < r.sent_at + INTERVAL '10 seconds' THEN 'instantaneo'
         END AS motivo
    FROM (SELECT x.*,
                 bool_or(x.links_1s >= 4)
                   OVER (PARTITION BY x.contact_id ORDER BY x.t
                         RANGE BETWEEN INTERVAL '10 seconds' PRECEDING AND INTERVAL '10 seconds' FOLLOWING) AS perto_rajada,
                 bool_or(x.links_60s >= 3 AND x.links_5min >= 5 AND x.util_5min >= 2)
                   OVER (PARTITION BY x.contact_id ORDER BY x.t
                         RANGE BETWEEN INTERVAL '60 seconds' PRECEDING AND INTERVAL '60 seconds' FOLLOWING) AS perto_nucleo
            FROM _cv x) v
    LEFT JOIN campaign_recipients r ON r.campaign_id = 131 AND r.contact_id = v.contact_id
) d WHERE d.motivo IS NOT NULL;

ANALYZE _cd;

CREATE TEMP TABLE _ck ON COMMIT DROP AS
SELECT c.id, c.contact_id, c.user_agent, c.created_at, d.motivo
  FROM _cc c
  JOIN _cd d ON d.contact_id = c.contact_id AND COALESCE(d.url, '') = COALESCE(c.url, '') AND d.balde = c.balde;

ANALYZE _ck;

CREATE TEMP TABLE _cq ON COMMIT DROP AS
SELECT id, motivo FROM _ck
UNION ALL
SELECT o.id, MIN(k.motivo)
  FROM email_events o
  JOIN _ck k ON k.contact_id = o.contact_id AND k.user_agent = o.user_agent
            AND o.created_at BETWEEN k.created_at - INTERVAL '2 minutes' AND k.created_at + INTERVAL '15 seconds'
 WHERE o.campaign_id = 131 AND o.user_agent IS NOT NULL
   AND (o.type = 'open' OR (o.type = 'open_auto' AND o.auto_reason IN ('rajada', 'varrimento', 'instantaneo')))
 GROUP BY o.id;

CREATE UNIQUE INDEX ON _cq (id);

ANALYZE _cq;

SELECT 131 AS campanha,
       (SELECT COUNT(DISTINCT k.contact_id) FROM _ck k)::int AS contactos_automaticos,
       (SELECT COUNT(*) FROM _ck k JOIN email_events e ON e.id = k.id WHERE e.type = 'click')::int AS cliques_a_marcar,
       (SELECT COUNT(*) FROM _cq q JOIN email_events e ON e.id = q.id WHERE e.type = 'open')::int AS aberturas_a_marcar,
       (SELECT COUNT(*) FROM email_events e WHERE e.campaign_id = 131 AND e.contact_id IS NOT NULL
           AND e.type IN ('click_auto', 'open_auto') AND e.auto_reason IN ('rajada', 'varrimento', 'instantaneo')
           AND NOT EXISTS (SELECT 1 FROM _cq q WHERE q.id = e.id))::int AS a_desmarcar,
       (SELECT COUNT(DISTINCT e.contact_id) FROM email_events e WHERE e.campaign_id = 131 AND e.type = 'click')::int AS clicaram_hoje,
       (SELECT COUNT(DISTINCT e.contact_id) FROM email_events e WHERE e.campaign_id = 131 AND e.contact_id IS NOT NULL
           AND ((e.type = 'click' AND NOT EXISTS (SELECT 1 FROM _cq q WHERE q.id = e.id))
             OR (e.type = 'click_auto' AND e.auto_reason IN ('rajada', 'varrimento', 'instantaneo') AND NOT EXISTS (SELECT 1 FROM _cq q WHERE q.id = e.id))))::int AS clicaram_depois,
       (SELECT COUNT(DISTINCT e.contact_id) FROM email_events e WHERE e.campaign_id = 131 AND e.type = 'open')::int AS abriram_hoje,
       (SELECT COUNT(DISTINCT e.contact_id) FROM email_events e WHERE e.campaign_id = 131 AND e.contact_id IS NOT NULL
           AND ((e.type = 'open' AND NOT EXISTS (SELECT 1 FROM _cq q WHERE q.id = e.id))
             OR (e.type = 'open_auto' AND e.auto_reason IN ('rajada', 'varrimento', 'instantaneo') AND NOT EXISTS (SELECT 1 FROM _cq q WHERE q.id = e.id))))::int AS abriram_depois;

-- ── 3. Pôr na fila (altera) ───────────────────────────────────────────────
-- O agendador revê no minuto seguinte. Para pôr TODAS as campanhas enviadas,
-- troca a linha do WHERE por: WHERE status::text = 'sent'
UPDATE campaigns SET cliques_revistos_em = NULL
 WHERE id = 131
RETURNING id, name;

-- ── 4. Progresso e resultado (só lê) ─────────────────────────────────────
SELECT c.id, c.name, c.cliques_revistos_em,
       (SELECT COUNT(DISTINCT e.contact_id) FROM email_events e
         WHERE e.campaign_id = c.id AND e.type = 'click_auto' AND e.auto_reason IS NOT NULL) AS contactos_automaticos,
       (SELECT COUNT(DISTINCT e.contact_id) FROM email_events e
         WHERE e.campaign_id = c.id AND e.type = 'click') AS contactos_que_clicaram
  FROM campaigns c
 WHERE c.status::text = 'sent'
 ORDER BY (c.cliques_revistos_em IS NULL) DESC, c.sent_at DESC
 LIMIT 50;

-- ── 5. O que ficou a contar como pessoa (só lê) ───────────────────────────
SELECT h.contact_id, h.created_at, h.url, h.user_agent
  FROM email_events h
 WHERE h.campaign_id = 131 AND h.type = 'click'
   AND EXISTS (SELECT 1 FROM email_events a
                WHERE a.campaign_id = h.campaign_id AND a.contact_id = h.contact_id
                  AND a.type = 'click_auto' AND a.auto_reason IS NOT NULL)
 ORDER BY h.contact_id, h.created_at;
