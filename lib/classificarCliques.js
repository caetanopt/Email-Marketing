// Cliques de analisadores de segurança que se fazem passar por browser.
//
// O AGENTE_AUTOMATICO do api/track.js só apanha quem se identifica. O
// Defender for Office 365 (Safe Links), o Proofpoint e o Mimecast seguem os
// links com um agente de Chrome igual ao de uma pessoa, e a prova "aberturas
// do Gmail contam" exige, com razão, que esse agente conte. Denuncia-os o
// comportamento: na campanha 131, 18 contactos clicaram uma vez em cada um dos
// 8 links, incluindo a política de privacidade, a versão web e as cinco redes
// sociais.
//
// ONDE E QUANDO CORRE
// Nunca no clique: o api/track.js não espera por nada disto. Cada campanha é
// revista pelo agendador (api/campaigns/index.js) DUAS vezes — 10 min depois
// de o envio terminar e 24 h depois —, uma de cada vez, numa transacção com
// tecto de tempo, com um trinco por campanha para duas passagens nunca se
// cruzarem. campaigns.cliques_revistos_em diz quando foi a última revisão.
// Duas versões anteriores (no clique, e de minuto a minuto sobre os últimos 3
// dias) foram rejeitadas na revisão: atrasavam redireccionamentos, ou ficavam
// quadráticas com o volume.
//
// As contas fazem-se em tabelas temporárias da própria transacção, com ANALYZE:
// sem estatísticas, o Postgres estima uma linha por CTE e escolhe junções
// quadráticas — foi o que fez a versão anterior parar ao fim de umas dezenas
// de milhares de eventos marcados.
//
// AS REGRAS (por contacto; os cliques do mesmo link contam uma vez por cada 5 s)
//   rajada      — 4+ links distintos em 1 s ou menos para cada lado (o núcleo),
//                 e os cliques do mesmo contacto até 10 s antes ou depois desse
//                 núcleo. Medido na campanha 131: 16 dos 18 contactos
//                 clicaram os 8 links em 0,0 a 2,7 s, quase todos em menos de
//                 meio segundo, entre 26 e 197 s depois do envio. Nenhuma
//                 pessoa clica 4 links diferentes num segundo; quem abre
//                 modelos em separadores continua a contar;
//   varrimento  — 5+ links distintos até 5 min antes ou depois, 2+ deles de
//                 rodapé, e o clique perto (60 s) de um núcleo denso (3+ links
//                 em 60 s). Só marca a primeira vez de cada link e os links de
//                 rodapé: quem volta à oferta depois do analisador continua a
//                 contar;
//   instantaneo — clique entre 5 s antes e 10 s depois de o SES aceitar a
//                 mensagem (campaign_recipients.sent_at).
// Links de rodapé: perfis de redes sociais, versão web e páginas de
// privacidade/RGPD, reconhecidos pelo CAMINHO do endereço (sem os UTM); um
// vídeo do YouTube no corpo não conta.
// Os cliques que cumprem passam a 'click_auto'. As aberturas do mesmo contacto
// com EXACTAMENTE o mesmo agente (nunca vazio), entre 2 min antes e 15 s depois
// de um desses cliques, passam a 'open_auto'. Nada é apagado: auto_reason
// guarda a regra (migração 068) e scripts/reverter-cliques-automaticos.sql
// desfaz exactamente isto. Os eventos marcados pelo agente no registo
// (auto_reason vazio) nunca são lidos nem tocados.
//
// Pessoas reais que ainda se podem perder (aceite, e medido por auto_reason):
// quem clica até 10 s antes ou depois de uma rajada do analisador do próprio
// email; quem clica até cerca de 60 s antes ou depois de um varrimento; 5+
// links com 2 de rodapé em poucos minutos, com 3 deles num minuto.
//
// Um contacto com mais de 300 pontos (um link reencaminhado e aberto milhares
// de vezes) fica de fora: não é um varrimento, e não pode tornar a revisão de
// uma campanha lenta.
const { query, transaction } = require('./db');

const MOTIVOS = ['rajada', 'varrimento', 'instantaneo'];
const LISTA_MOTIVOS = `('rajada', 'varrimento', 'instantaneo')`;
const LINK_DE_RODAPE = String.raw`^https?://([a-z0-9-]+\.)*(facebook|instagram|linkedin|tiktok|twitter|x|pinterest)\.com(/|$)|^https?://([a-z0-9-]+\.)*youtube\.com/(?!(watch|shorts|embed|live|playlist)(/|$))|/v/[0-9]+/|/api/preview$|privacidade|privacy|rgpd`;
const MAX_PONTOS_POR_CONTACTO = 300;

// As instruções que decidem, para uma campanha. São as mesmas na revisão do
// agendador e na pré-visualização de scripts/reclassificar-cliques.sql (o
// ficheiro é gerado a partir daqui, e a prova compara-os).
function instrucoesDecisao(id) {
  const c = Number(id);
  if (!Number.isSafeInteger(c) || c <= 0) throw new Error('campanha inválida');
  return [
    // 1. Cliques desta campanha: os que contam e os que estas regras marcaram.
    `CREATE TEMP TABLE _cc ON COMMIT DROP AS
SELECT e.id, e.contact_id, e.url, e.user_agent, e.created_at,
       floor(extract(epoch FROM e.created_at) / 5)::bigint AS balde
  FROM email_events e
 WHERE e.campaign_id = ${c} AND e.contact_id IS NOT NULL
   AND (e.type = 'click' OR (e.type = 'click_auto' AND e.auto_reason IN ${LISTA_MOTIVOS}))`,
    // 2. Pontos: um por link e por 5 s.
    `CREATE TEMP TABLE _cp ON COMMIT DROP AS
SELECT p.*, p.t = MIN(p.t) OVER (PARTITION BY p.contact_id, p.url) AS primeira_vez
  FROM (SELECT contact_id, url, balde, MIN(created_at) AS t,
               COALESCE(lower(split_part(split_part(url, '#', 1), '?', 1)) ~ '${LINK_DE_RODAPE}', false) AS util
          FROM _cc
         GROUP BY contact_id, url, balde) p`,
    `DELETE FROM _cp WHERE contact_id IN (SELECT contact_id FROM _cp GROUP BY contact_id HAVING COUNT(*) > ${MAX_PONTOS_POR_CONTACTO})`,
    `CREATE INDEX ON _cp (contact_id, t)`,
    `ANALYZE _cp`,
    // 3. O que cada ponto tem à volta.
    `CREATE TEMP TABLE _cv ON COMMIT DROP AS
SELECT p.contact_id, p.url, p.balde, p.t, p.util, p.primeira_vez,
       COUNT(DISTINCT q.url) FILTER (WHERE q.t BETWEEN p.t - INTERVAL '1 second' AND p.t + INTERVAL '1 second') AS links_1s,
       COUNT(DISTINCT q.url) FILTER (WHERE q.t BETWEEN p.t - INTERVAL '60 seconds' AND p.t + INTERVAL '60 seconds') AS links_60s,
       COUNT(DISTINCT q.url) AS links_5min,
       COUNT(DISTINCT q.url) FILTER (WHERE q.util) AS util_5min
  FROM _cp p
  JOIN _cp q ON q.contact_id = p.contact_id
            AND q.t BETWEEN p.t - INTERVAL '5 minutes' AND p.t + INTERVAL '5 minutes'
 GROUP BY p.contact_id, p.url, p.balde, p.t, p.util, p.primeira_vez`,
    // 4. A decisão por ponto.
    `CREATE TEMP TABLE _cd ON COMMIT DROP AS
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
    LEFT JOIN campaign_recipients r ON r.campaign_id = ${c} AND r.contact_id = v.contact_id
) d WHERE d.motivo IS NOT NULL`,
    `ANALYZE _cd`,
    // 5. Os cliques que devem ficar marcados.
    `CREATE TEMP TABLE _ck ON COMMIT DROP AS
SELECT c.id, c.contact_id, c.user_agent, c.created_at, d.motivo
  FROM _cc c
  JOIN _cd d ON d.contact_id = c.contact_id AND COALESCE(d.url, '') = COALESCE(c.url, '') AND d.balde = c.balde`,
    `ANALYZE _ck`,
    // 6. Tudo o que deve ficar marcado: esses cliques e as aberturas com o
    //    mesmo agente à volta deles.
    `CREATE TEMP TABLE _cq ON COMMIT DROP AS
SELECT id, motivo FROM _ck
UNION ALL
SELECT o.id, MIN(k.motivo)
  FROM email_events o
  JOIN _ck k ON k.contact_id = o.contact_id AND k.user_agent = o.user_agent
            AND o.created_at BETWEEN k.created_at - INTERVAL '2 minutes' AND k.created_at + INTERVAL '15 seconds'
 WHERE o.campaign_id = ${c} AND o.user_agent IS NOT NULL
   AND (o.type = 'open' OR (o.type = 'open_auto' AND o.auto_reason IN ${LISTA_MOTIVOS}))
 GROUP BY o.id`,
    `CREATE UNIQUE INDEX ON _cq (id)`,
    `ANALYZE _cq`,
  ];
}

// Pôr os eventos desta campanha como a decisão diz: marcar o que falta e
// desmarcar o que estas regras marcaram e deixou de cumprir.
function instrucoesAplicar(id) {
  const c = Number(id);
  if (!Number.isSafeInteger(c) || c <= 0) throw new Error('campanha inválida');
  return [
    `WITH m AS (
  UPDATE email_events e
     SET type = (CASE WHEN e.type IN ('click', 'click_auto') THEN 'click_auto' ELSE 'open_auto' END)::event_type,
         auto_reason = q.motivo
    FROM _cq q
   WHERE e.id = q.id AND e.campaign_id = ${c}
     AND (e.type IN ('click', 'open') OR e.auto_reason IS DISTINCT FROM q.motivo)
  RETURNING e.type::text AS tipo, e.contact_id
), d AS (
  UPDATE email_events e
     SET type = (CASE WHEN e.type = 'click_auto' THEN 'click' ELSE 'open' END)::event_type,
         auto_reason = NULL
   WHERE e.campaign_id = ${c} AND e.contact_id IS NOT NULL
     AND e.type IN ('click_auto', 'open_auto') AND e.auto_reason IN ${LISTA_MOTIVOS}
     AND NOT EXISTS (SELECT 1 FROM _cq q WHERE q.id = e.id)
  RETURNING e.type::text AS tipo
)
SELECT (SELECT COUNT(*) FROM m WHERE tipo = 'click_auto')::int AS cliques_marcados,
       (SELECT COUNT(*) FROM m WHERE tipo = 'open_auto')::int  AS aberturas_marcadas,
       (SELECT COUNT(DISTINCT contact_id) FROM m)::int        AS contactos,
       (SELECT COUNT(*) FROM d)::int                          AS desmarcados`,
    `UPDATE campaigns SET cliques_revistos_em = NOW() WHERE id = ${c}`,
  ];
}

// Resumo para a pré-visualização: o que muda e o efeito nos números do
// relatório (contactos únicos que abriram e que clicaram).
function instrucaoResumo(id) {
  const c = Number(id);
  if (!Number.isSafeInteger(c) || c <= 0) throw new Error('campanha inválida');
  return `SELECT ${c} AS campanha,
       (SELECT COUNT(DISTINCT k.contact_id) FROM _ck k)::int AS contactos_automaticos,
       (SELECT COUNT(*) FROM _ck k JOIN email_events e ON e.id = k.id WHERE e.type = 'click')::int AS cliques_a_marcar,
       (SELECT COUNT(*) FROM _cq q JOIN email_events e ON e.id = q.id WHERE e.type = 'open')::int AS aberturas_a_marcar,
       (SELECT COUNT(*) FROM email_events e WHERE e.campaign_id = ${c} AND e.contact_id IS NOT NULL
           AND e.type IN ('click_auto', 'open_auto') AND e.auto_reason IN ${LISTA_MOTIVOS}
           AND NOT EXISTS (SELECT 1 FROM _cq q WHERE q.id = e.id))::int AS a_desmarcar,
       (SELECT COUNT(DISTINCT e.contact_id) FROM email_events e WHERE e.campaign_id = ${c} AND e.type = 'click')::int AS clicaram_hoje,
       (SELECT COUNT(DISTINCT e.contact_id) FROM email_events e WHERE e.campaign_id = ${c} AND e.contact_id IS NOT NULL
           AND ((e.type = 'click' AND NOT EXISTS (SELECT 1 FROM _cq q WHERE q.id = e.id))
             OR (e.type = 'click_auto' AND e.auto_reason IN ${LISTA_MOTIVOS} AND NOT EXISTS (SELECT 1 FROM _cq q WHERE q.id = e.id))))::int AS clicaram_depois,
       (SELECT COUNT(DISTINCT e.contact_id) FROM email_events e WHERE e.campaign_id = ${c} AND e.type = 'open')::int AS abriram_hoje,
       (SELECT COUNT(DISTINCT e.contact_id) FROM email_events e WHERE e.campaign_id = ${c} AND e.contact_id IS NOT NULL
           AND ((e.type = 'open' AND NOT EXISTS (SELECT 1 FROM _cq q WHERE q.id = e.id))
             OR (e.type = 'open_auto' AND e.auto_reason IN ${LISTA_MOTIVOS} AND NOT EXISTS (SELECT 1 FROM _cq q WHERE q.id = e.id))))::int AS abriram_depois`;
}

// Campanhas por rever: enviadas há 10+ min e nunca revistas, ou revistas
// antes das 24 h e já com 24 h. As que falharam vão para o fim da fila
// (cliques_tentado_em), para uma campanha problemática não tapar as outras.
const SQL_PENDENTES = `SELECT id FROM campaigns
 WHERE status::text = 'sent' AND sent_at IS NOT NULL AND sent_at < NOW() - INTERVAL '10 minutes'
   AND (cliques_revistos_em IS NULL
        OR (cliques_revistos_em < sent_at + INTERVAL '1 day' AND NOW() >= sent_at + INTERVAL '1 day'))
 ORDER BY cliques_tentado_em NULLS FIRST, sent_at
 LIMIT 5`;

// Sem a migração 068 (42703/42P01) ou a 054 (22P02), não há onde gravar:
// desliga-se 10 min e volta a tentar.
let desligadoAte = 0;
const ERROS_DE_MIGRACAO = new Set(['42703', '42P01', '22P02']);

// Revê uma campanha. Lança em caso de erro; quem chama decide.
async function reverCampanha(id, { tectoMs = 3000 } = {}) {
  const tecto = Math.max(500, Math.min(10000, Math.floor(tectoMs)));
  return transaction(async (q) => {
    // Um trinco por campanha, só desta transacção: uma segunda passagem
    // (outra invocação do agendador) salta-a em vez de esperar.
    const [{ livre }] = await q(`SELECT pg_try_advisory_xact_lock(hashtext('classificarCliques'), $1) AS livre`, [Number(id)]);
    if (!livre) return { id, ocupada: true };
    await q(`SELECT set_config('statement_timeout', $1, true), set_config('lock_timeout', '500', true),
                    set_config('idle_in_transaction_session_timeout', $2, true)`,
      [String(tecto), String(tecto + 2000)]);
    for (const sql of instrucoesDecisao(id)) await q(sql);
    const [aplicar, marcarRevista] = instrucoesAplicar(id);
    const [res] = await q(aplicar);
    await q(marcarRevista);
    return { id, ...res };
  });
}

// Corre no agendador. Nunca lança: o agendador existe para enviar campanhas,
// e isto não o pode impedir nem atrasar mais do que o orçamento.
async function reverCampanhasPendentes({ orcamentoMs = 4000 } = {}) {
  if (Date.now() < desligadoAte) return { saltado: true };
  const inicio = Date.now();
  const resta = () => orcamentoMs - (Date.now() - inicio);
  const feitas = [];
  try {
    const pendentes = await comTecto(query(SQL_PENDENTES), resta());
    for (const { id } of pendentes) {
      if (resta() < 1000) break;
      // Vai para o fim da fila já, antes de tentar: se falhar, não tapa as
      // outras na passagem seguinte.
      await comTecto(query('UPDATE campaigns SET cliques_tentado_em = NOW() WHERE id = $1', [id]), resta());
      try {
        feitas.push(await comTecto(reverCampanha(id, { tectoMs: resta() - 500 }), resta()));
      } catch (e) {
        if (ERROS_DE_MIGRACAO.has(e?.code)) throw e;
        console.error(`classificação de cliques: campanha ${id} falhou:`, e?.code, e?.message);
        feitas.push({ id, erro: e?.code || e?.message || String(e) });
      }
    }
    return { feitas };
  } catch (e) {
    if (ERROS_DE_MIGRACAO.has(e?.code)) {
      desligadoAte = Date.now() + 10 * 60 * 1000;
      return { saltado: true, motivo: e.code };
    }
    console.error('classificação de cliques falhou:', e?.code, e?.message);
    return { feitas, erro: e?.code || e?.message || String(e) };
  }
}

// Tecto de tempo REAL (o statement_timeout só cobre o Postgres, não a espera
// por uma ligação livre nem uma rede parada). A promessa original continua e
// acaba sozinha (a transacção desfaz-se); quem chama segue em frente.
function comTecto(promessa, ms) {
  let t;
  const limite = new Promise((_, rej) => { t = setTimeout(() => rej(Object.assign(new Error('tempo esgotado'), { code: 'TECTO' })), Math.max(0, ms)); });
  promessa.catch(() => {});
  return Promise.race([promessa, limite]).finally(() => clearTimeout(t));
}

// Texto da pré-visualização para o editor de SQL do Supabase (só muda
// tabelas temporárias, que desaparecem no fim). O editor corre o texto todo
// numa transacção e mostra o resultado da última instrução: o resumo.
function scriptPrevisualizacao(id) {
  return [...instrucoesDecisao(id), instrucaoResumo(id)].map(s => s + ';').join('\n\n');
}

// scripts/reclassificar-cliques.sql é gerado por esta função (a prova em
// scripts/check-runtime.js exige que o ficheiro seja exactamente isto): a
// pré-visualização usa as mesmas instruções que o agendador.
function gerarScript() {
  return `-- Cliques e aberturas de analisadores de segurança: ver, pré-visualizar e
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
${scriptPrevisualizacao(131)}

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
`;
}

module.exports = {
  reverCampanhasPendentes, reverCampanha, instrucoesDecisao, instrucoesAplicar, instrucaoResumo,
  scriptPrevisualizacao, gerarScript, SQL_PENDENTES, MOTIVOS, LINK_DE_RODAPE, MAX_PONTOS_POR_CONTACTO, comTecto,
};
