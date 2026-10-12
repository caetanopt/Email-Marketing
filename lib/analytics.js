const crypto = require('crypto');
const { query, transaction } = require('./db');
const { rateLimit } = require('./ratelimit');

// API de estatísticas — leitura dos números das campanhas de cada marca, para
// ferramentas de fora (Power BI, Looker Studio, Google Sheets, Excel, n8n…).
//
// Não é uma função nova: o plano da Vercel está no limite de 12. Vive dentro
// de api/sync/index.js, e o vercel.json reescreve /api/analytics/* para lá.
//
// A chave é PRÓPRIA (pma_…) e só lê. A chave de sincronização (pmg_/pm_)
// escreve contactos e cancela subscrições; colá-la num painel de BI por
// causa de números agregados seria dar muito mais do que é preciso. Esta não
// abre nenhum dado pessoal: só contagens por campanha e por marca, e os links
// sem os parâmetros (um template pode montar links com o email da pessoa).
//
// Os números são os do relatório de cada campanha (api/campaigns/[id].js,
// action=report): aberturas e cliques únicos POR CAMPANHA, só de quem recebeu
// (estado 'sent'), sem os automáticos (open_auto/click_auto). Os totais de
// cada marca são a soma das campanhas, como no ecrã Estatísticas.

const FUSO = 'Europe/Lisbon';
const PREFIXO = 'pma_';
const FORMATO_CHAVE = /^pma_[0-9a-f]{64}$/;

// As mesmas janelas do ecrã Estatísticas (action=global_stats), para que um
// range=12m dê exactamente o mesmo período que o ecrã.
const JANELAS = { '7d': 7, '30d': 30, '90d': 90, '12m': 365, 'all': null };

const LIMITE_OMISSAO = 100;
const LIMITE_MAXIMO = 1000;

// Um link clicado por menos pessoas do que isto não sai com o endereço: vai
// para other_links. Um template pode pôr dados da pessoa no CAMINHO do link
// (/reserva/{{email}}, /revisao/{{matricula}}) e cada um desses caminhos só
// tem um clique — com o endereço à vista, era uma lista de quem clicou.
const MIN_PESSOAS_POR_LINK = 5;

// Vagas para as consultas pesadas (marcas e listas de campanhas), em toda a
// aplicação. A base é partilhada com o envio e com o redireccionador de
// cliques; um painel de BI a pedir oito tabelas ao mesmo tempo esgotava as
// ligações e fazia-as todas passar dos 20 s.
const VAGAS_PESADAS = 2;
// Quanto se espera por uma vaga antes do 429 (exportado para os testes).
const opcoes = { esperaPorVagaMs: 25000 };
// E um tecto por minuto para essas, contado depois da chave (antes, qualquer
// pessoa sem chave podia gastá-lo e bloquear o painel verdadeiro).
const PESADAS_POR_MINUTO = 20;

const hashDaChave = (chave) => crypto.createHash('sha256').update(chave).digest('hex');

function gerarChave() {
  const chave = PREFIXO + crypto.randomBytes(32).toString('hex');
  return { chave, hash: hashDaChave(chave) };
}

// Um parâmetro repetido (?id=1&id=2) chega como array: conta o primeiro.
const primeiro = (v) => (Array.isArray(v) ? v[0] : v);

function erroDoPedido(mensagem, status = 400) {
  const e = new Error(mensagem);
  e.status = status;
  return e;
}

function chaveDoPedido(req) {
  const auth = String(req.headers?.authorization || '').trim();
  if (/^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  // Na URL, para quem não consegue mandar cabeçalhos (IMPORTDATA do Google
  // Sheets, alguns conectores de BI). Fica nos registos de acesso da Vercel —
  // por isso a chave só lê números agregados, e o cabeçalho é o preferido.
  const k = primeiro(req.query?.key);
  return typeof k === 'string' ? k.trim() : '';
}

async function autenticar(req) {
  const chave = chaveDoPedido(req);
  if (!chave) return { status: 401, error: 'Falta a chave: cabeçalho Authorization: Bearer <chave>, ou ?key=<chave>.' };
  if (!FORMATO_CHAVE.test(chave)) {
    if (/^pmg?_/.test(chave)) {
      return { status: 403, error: 'Esta chave é da API de sincronização. A API de estatísticas usa uma chave própria (pma_…), gerada em Definições gerais.' };
    }
    return { status: 401, error: 'Chave inválida.' };
  }
  let guardado = null;
  try {
    const rows = await query('SELECT analytics_api_key_hash FROM global_settings WHERE id=1');
    guardado = rows[0]?.analytics_api_key_hash || null;
  } catch (e) {
    // Coluna ou tabela em falta: ainda não foi gerada nenhuma chave.
    if (e.code !== '42703' && e.code !== '42P01') throw e;
  }
  if (!guardado || !/^[0-9a-f]{64}$/.test(guardado)) return { status: 401, error: 'Chave inválida.' };
  const certo = crypto.timingSafeEqual(Buffer.from(hashDaChave(chave), 'hex'), Buffer.from(guardado, 'hex'));
  return certo ? { ok: true } : { status: 401, error: 'Chave inválida.' };
}

// ── Período ────────────────────────────────────────────────────────────────

const DATA = /^\d{4}-\d{2}-\d{2}$/;

function lerData(valor, nome) {
  const v = primeiro(valor);
  if (v == null || v === '') return null;
  if (typeof v !== 'string' || !DATA.test(v)) throw erroDoPedido(`${nome} tem de ser uma data no formato AAAA-MM-DD.`);
  // O ano 0000 é uma data válida em JavaScript mas não no Postgres (500).
  if (v < '1970-01-01') throw erroDoPedido(`${nome} tem de ser 1970-01-01 ou depois.`);
  const d = new Date(v + 'T00:00:00Z');
  if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw erroDoPedido(`${nome} não é uma data válida.`);
  return v;
}

// Acrescenta a condição do período a `params` e devolve o SQL e o período
// efectivo (que a resposta repete, para não haver dúvida sobre o que foi
// somado). from/to são dias de calendário em Lisboa, os dois incluídos.
function filtroDoPeriodo(q, params, rangeOmissao) {
  const from = lerData(q.from, 'from');
  const to = lerData(q.to, 'to');
  const range = primeiro(q.range);
  if ((from || to) && range) throw erroDoPedido('Usa range ou from/to, não os dois.');

  if (from || to) {
    if (from && to && from > to) throw erroDoPedido('from não pode ser depois de to.');
    let sql = '';
    if (from) { params.push(from); sql += ` AND c.sent_at >= ($${params.length}::date)::timestamp AT TIME ZONE '${FUSO}'`; }
    if (to)   { params.push(to);   sql += ` AND c.sent_at < (($${params.length}::date + 1)::timestamp AT TIME ZONE '${FUSO}')`; }
    return { sql, periodo: { from, to, timezone: FUSO } };
  }

  const chave = range == null || range === '' ? rangeOmissao : String(range);
  if (!Object.prototype.hasOwnProperty.call(JANELAS, chave)) {
    throw erroDoPedido(`range tem de ser um de: ${Object.keys(JANELAS).join(', ')}.`);
  }
  const dias = JANELAS[chave];
  if (dias == null) return { sql: '', periodo: { range: 'all' } };
  params.push(dias);
  return {
    sql: ` AND c.sent_at >= NOW() - ($${params.length} * INTERVAL '1 day')`,
    periodo: { range: chave, since: new Date(Date.now() - dias * 86400000).toISOString() },
  };
}

function lerInteiro(valor, nome, { omissao, min, max }) {
  const v = primeiro(valor);
  if (v == null || v === '') return omissao;
  if (!/^\d+$/.test(String(v))) throw erroDoPedido(`${nome} tem de ser um número inteiro.`);
  const n = parseInt(v, 10);
  if (n < min || n > max) throw erroDoPedido(`${nome} tem de estar entre ${min} e ${max}.`);
  return n;
}

function lerMarca(q) {
  const v = primeiro(q.brand_id);
  if (v == null || v === '') return null;
  const s = String(v).trim();
  if (!s || s.length > 100) throw erroDoPedido('brand_id inválido.');
  return s;
}

function lerFormato(q) {
  const f = String(primeiro(q.format) || 'json').toLowerCase();
  if (f !== 'json' && f !== 'csv') throw erroDoPedido('format tem de ser json ou csv.');
  return f;
}

// ── Métricas ───────────────────────────────────────────────────────────────

// As taxas como no ecrã: percentagem com uma casa decimal.
const taxa = (n, d) => (d ? +((n / d) * 100).toFixed(1) : 0);

const CONTADORES = [
  'total_recipients', 'delivered', 'bounced', 'failed', 'suppressed',
  'unique_opens', 'total_opens', 'unique_clicks', 'total_clicks',
  'unsubscribes', 'spam_complaints', 'automated_opens', 'automated_clicks',
];

function comTaxas(m) {
  return {
    ...m,
    delivery_rate: taxa(m.delivered, m.total_recipients),
    open_rate: taxa(m.unique_opens, m.delivered),
    click_rate: taxa(m.unique_clicks, m.delivered),
    ctor: taxa(m.unique_clicks, m.unique_opens),
    bounce_rate: taxa(m.bounced, m.delivered + m.bounced),
    unsubscribe_rate: taxa(m.unsubscribes, m.delivered),
    // Uma queixa tira a pessoa dos entregues (o estado passa a 'failed'), por
    // isso volta a somar-se ao denominador, como os bounces.
    spam_rate: taxa(m.spam_complaints, m.delivered + m.spam_complaints),
  };
}

const vazio = () => Object.fromEntries(CONTADORES.map(k => [k, 0]));

// Contadores de cada campanha, numa passagem por tabela. Juntar destinatários
// e eventos na mesma linha multiplica-os (produto cartesiano) — por isso cada
// tabela é agregada à parte, como no global_stats.
//
// Aberturas e cliques: só de destinatários entregues (cr.status='sent'), como
// no relatório — o numerador fica sempre dentro do denominador. Os tipos são
// comparados como texto para não rebentar numa base sem os valores da 054.
//
// Uma consulta de cada vez, numa só ligação: em paralelo, cada pedido
// prendia duas. E sem filtrar o tipo no WHERE: comparado como texto, o
// planeador estimava 50 vezes menos eventos e escolhia um ciclo com uma
// leitura de campaign_recipients por evento (6 milhões de blocos em vez de
// 45 mil). O cr.campaign_id = ANY dá-lhe a estimativa certa.
async function metricasDasCampanhas(ids, q = query) {
  const mapa = new Map(ids.map(id => [id, vazio()]));
  if (!ids.length) return mapa;
  const rc = await q(
    `SELECT campaign_id,
            COUNT(*)::int                                     AS total_recipients,
            COUNT(*) FILTER (WHERE status='sent')::int        AS delivered,
            COUNT(*) FILTER (WHERE status='bounced')::int     AS bounced,
            COUNT(*) FILTER (WHERE status='failed')::int      AS failed,
            COUNT(*) FILTER (WHERE status='suppressed')::int  AS suppressed
     FROM campaign_recipients
     WHERE campaign_id = ANY($1::int[])
     GROUP BY campaign_id`, [ids]);
  const ev = await q(
    `SELECT ee.campaign_id,
            COUNT(DISTINCT ee.contact_id) FILTER (WHERE ee.type::text='open'  AND cr.contact_id IS NOT NULL)::int AS unique_opens,
            COUNT(*)                      FILTER (WHERE ee.type::text='open'  AND cr.contact_id IS NOT NULL)::int AS total_opens,
            COUNT(DISTINCT ee.contact_id) FILTER (WHERE ee.type::text='click' AND cr.contact_id IS NOT NULL)::int AS unique_clicks,
            COUNT(*)                      FILTER (WHERE ee.type::text='click' AND cr.contact_id IS NOT NULL)::int AS total_clicks,
            COUNT(DISTINCT ee.contact_id) FILTER (WHERE ee.type::text='unsubscribe')::int AS unsubscribes,
            COUNT(DISTINCT ee.contact_id) FILTER (WHERE ee.type::text='spam')::int        AS spam_complaints,
            COUNT(DISTINCT ee.contact_id) FILTER (WHERE ee.type::text='open_auto')::int   AS automated_opens,
            COUNT(DISTINCT ee.contact_id) FILTER (WHERE ee.type::text='click_auto')::int  AS automated_clicks
     FROM email_events ee
     LEFT JOIN campaign_recipients cr
            ON cr.campaign_id = ee.campaign_id AND cr.contact_id = ee.contact_id AND cr.status = 'sent'
           AND cr.campaign_id = ANY($1::int[])
     WHERE ee.campaign_id = ANY($1::int[])
     GROUP BY ee.campaign_id`, [ids]);
  for (const linha of [...rc, ...ev]) {
    const m = mapa.get(linha.campaign_id);
    if (!m) continue;
    for (const k of CONTADORES) if (linha[k] != null) m[k] = linha[k];
  }
  return mapa;
}

// Corre `fn` numa transacção que ocupa uma das VAGAS_PESADAS. Trincos de
// transacção (não de sessão), por isso funcionam no pooler de transacções do
// Supabase e soltam-se sozinhos no fim.
//
// Sem vaga livre, a transacção fecha logo e tenta-se outra vez daí a meio
// segundo — quem espera não prende uma ligação (com oito à espera dentro de
// transacções, eram oito ligações do pooler paradas, que o envio e os
// cliques precisam). Ao fim de esperaPorVagaMs, 429 com Retry-After.
const SEM_VAGA = Symbol('sem vaga');
async function comVaga(fn) {
  const casos = Array.from({ length: VAGAS_PESADAS }, (_, i) => `WHEN pg_try_advisory_xact_lock(hashtext('analytics'), ${i + 1}) THEN ${i + 1}`).join(' ');
  const limite = Date.now() + opcoes.esperaPorVagaMs;
  for (;;) {
    const r = await transaction(async (q) => {
      // CASE avalia as condições por ordem: fica-se com uma vaga só.
      const [{ vaga }] = await q(`SELECT CASE ${casos} ELSE 0 END AS vaga`);
      if (!vaga) return SEM_VAGA;
      return { valor: await fn(q) };
    });
    if (r !== SEM_VAGA) return r.valor;
    if (Date.now() + 500 >= limite) {
      const ocupado = erroDoPedido('Há outros pedidos pesados a correr. Tenta daqui a 15 segundos.', 429);
      ocupado.retryAfter = 15;
      throw ocupado;
    }
    await new Promise(ok => setTimeout(ok, 400 + Math.floor(Math.random() * 300)));
  }
}

// ── CSV ────────────────────────────────────────────────────────────────────

function celula(v) {
  if (v == null) return '';
  if (typeof v === 'number') return String(v);
  let s = v instanceof Date ? v.toISOString() : String(v);
  // Um nome começado por = + - @ seria lido como fórmula pelo Excel ou pelo
  // Sheets (injecção de CSV). O apóstrofo força texto.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function paraCsv(linhas, colunas) {
  const corpo = linhas.map(l => colunas.map(c => celula(l[c])).join(','));
  return [colunas.join(','), ...corpo].join('\r\n') + '\r\n';
}

function enviarCsv(res, nome, linhas, colunas) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `inline; filename="${nome}.csv"`);
  return res.status(200).send(paraCsv(linhas, colunas));
}

const COLUNAS_METRICAS = [
  ...CONTADORES,
  'delivery_rate', 'open_rate', 'click_rate', 'ctor', 'bounce_rate', 'unsubscribe_rate', 'spam_rate',
];

// ── Recursos ───────────────────────────────────────────────────────────────

const DATA_LOCAL = `'YYYY-MM-DD HH24:MI:SS'`;

// GET /api/analytics/brands — totais de cada marca no período.
async function marcas(req, res) {
  const q = req.query;
  const formato = lerFormato(q);
  const params = [];
  const { sql: periodoSql, periodo } = filtroDoPeriodo(q, params, '12m');
  const marca = lerMarca(q);
  let marcaSql = '';
  if (marca) { params.push(marca); marcaSql = ` AND b.id = $${params.length}`; }

  const listaMarcas = await query(`SELECT b.id, b.name FROM brands b WHERE b.active = TRUE${marca ? ' AND b.id = $1' : ''} ORDER BY b.name`, marca ? [marca] : []);
  if (marca && !listaMarcas.length) throw erroDoPedido('Marca não encontrada (ou inactiva).', 404);
  const { enviadas, metricas } = await comVaga(async (q) => {
    const enviadas = await q(
      `SELECT c.id, c.brand_id
       FROM campaigns c JOIN brands b ON b.id = c.brand_id
       WHERE c.status = 'sent' AND b.active = TRUE${periodoSql}${marcaSql}`, params);
    return { enviadas, metricas: await metricasDasCampanhas(enviadas.map(c => c.id), q) };
  });
  const porMarca = new Map(listaMarcas.map(b => [b.id, { campaigns: 0, ...vazio() }]));
  for (const c of enviadas) {
    const soma = porMarca.get(c.brand_id);
    if (!soma) continue;
    soma.campaigns++;
    const m = metricas.get(c.id);
    for (const k of CONTADORES) soma[k] += m[k];
  }
  const total = { campaigns: 0, ...vazio() };
  const data = listaMarcas.map(b => {
    const soma = porMarca.get(b.id);
    total.campaigns += soma.campaigns;
    for (const k of CONTADORES) total[k] += soma[k];
    return { brand_id: b.id, brand_name: b.name, ...comTaxas(soma) };
  }).sort((a, b) => b.delivered - a.delivered || a.brand_name.localeCompare(b.brand_name));

  if (formato === 'csv') return enviarCsv(res, 'marcas', data, ['brand_id', 'brand_name', 'campaigns', ...COLUNAS_METRICAS]);
  return res.status(200).json({ period: periodo, totals: comTaxas(total), data });
}

// GET /api/analytics/campaigns — campanhas enviadas, da mais recente para a
// mais antiga, com os números de cada uma.
async function campanhas(req, res) {
  const q = req.query;
  const formato = lerFormato(q);
  const limit = lerInteiro(q.limit, 'limit', { omissao: LIMITE_OMISSAO, min: 1, max: LIMITE_MAXIMO });
  const offset = lerInteiro(q.offset, 'offset', { omissao: 0, min: 0, max: 10000000 });
  const params = [];
  const { sql: periodoSql, periodo } = filtroDoPeriodo(q, params, 'all');
  const marca = lerMarca(q);
  let marcaSql = '';
  if (marca) { params.push(marca); marcaSql = ` AND c.brand_id = $${params.length}`; }
  params.push(limit, offset);

  const { linhas, total, metricas } = await comVaga(async (q) => {
    const linhas = await q(
      `SELECT c.id, c.brand_id, b.name AS brand_name, c.name, c.subject, c.sent_at,
              to_char(c.sent_at AT TIME ZONE '${FUSO}', ${DATA_LOCAL}) AS sent_at_local,
              COUNT(*) OVER ()::int AS _total
       FROM campaigns c JOIN brands b ON b.id = c.brand_id
       WHERE c.status = 'sent' AND b.active = TRUE${periodoSql}${marcaSql}
       ORDER BY c.sent_at DESC NULLS LAST, c.id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    // Pedida uma página para lá do fim, o COUNT(*) OVER () não tem linha onde
    // vir: conta-se à parte.
    let total = linhas[0]?._total;
    if (total == null) {
      const [r] = await q(
        `SELECT COUNT(*)::int AS n FROM campaigns c JOIN brands b ON b.id = c.brand_id
         WHERE c.status = 'sent' AND b.active = TRUE${periodoSql}${marcaSql}`, params.slice(0, -2));
      total = r?.n || 0;
    }
    return { linhas, total, metricas: await metricasDasCampanhas(linhas.map(c => c.id), q) };
  });
  const data = linhas.map(({ _total, ...c }) => ({ ...c, ...comTaxas(metricas.get(c.id)) }));

  res.setHeader('X-Total-Count', String(total));
  if (formato === 'csv') {
    return enviarCsv(res, 'campanhas', data,
      ['id', 'brand_id', 'brand_name', 'name', 'subject', 'sent_at', 'sent_at_local', ...COLUNAS_METRICAS]);
  }
  const seguinte = offset + linhas.length < total ? offset + linhas.length : null;
  return res.status(200).json({
    period: periodo,
    brand_id: marca,
    pagination: { limit, offset, total, next_offset: seguinte },
    data,
  });
}

// GET /api/analytics/campaigns/:id — uma campanha em detalhe: números, links,
// evolução no tempo e listas.
async function campanha(req, res) {
  const q = req.query;
  const id = lerInteiro(q.id, 'id', { omissao: null, min: 1, max: 2147483647 });
  if (id == null) throw erroDoPedido('Falta o id da campanha.');
  const granularidade = String(primeiro(q.granularity) || 'hour').toLowerCase();
  if (granularidade !== 'hour' && granularidade !== 'day') throw erroDoPedido('granularity tem de ser hour ou day.');

  const [c] = await query(
    `SELECT c.id, c.brand_id, b.name AS brand_name, c.name, c.subject, c.sent_at,
            to_char(c.sent_at AT TIME ZONE '${FUSO}', ${DATA_LOCAL}) AS sent_at_local
     FROM campaigns c JOIN brands b ON b.id = c.brand_id
     WHERE c.id = $1 AND c.status = 'sent' AND b.active = TRUE`, [id]);
  if (!c) throw erroDoPedido('Campanha não encontrada (ou ainda não enviada).', 404);

  // Por hora: as primeiras 168 horas com actividade, como no relatório. Por
  // dia: até um ano, em dias de Lisboa. A hora agrupa-se pelo instante (UTC):
  // em hora de Lisboa, na noite em que a hora muda, duas horas diferentes
  // caíam no mesmo balde "01:00". period_start distingue-as.
  const inicio = granularidade === 'day'
    ? `date_trunc('day', ee.created_at, '${FUSO}')`
    : `date_trunc('hour', ee.created_at, 'UTC')`;
  const rotulo = granularidade === 'day' ? 'YYYY-MM-DD' : 'YYYY-MM-DD HH24:00';
  const limiteBaldes = granularidade === 'day' ? 366 : 168;

  // Uma consulta de cada vez: o pedido ocupa uma ligação só.
  const metricas = await metricasDasCampanhas([id]);
  // Sem a query string nem o fragmento: os UTM partiam o mesmo link em vários.
  // Um endereço com @ fica só com o domínio, e os links de menos de
  // MIN_PESSOAS_POR_LINK pessoas vão juntos para other_links.
  const grupos = await query(
    `WITH n AS (
       SELECT CASE WHEN position('@' IN u.url) > 0
                   THEN COALESCE(substring(u.url FROM '^([A-Za-z]+://[^/@?#]+)(?:/|$)'), '(endereço)')
                   ELSE u.url END AS url,
              u.contact_id
       FROM (
         SELECT split_part(split_part(ee.url, '#', 1), '?', 1) AS url, ee.contact_id
         FROM email_events ee
         JOIN campaign_recipients cr
           ON cr.campaign_id = ee.campaign_id AND cr.contact_id = ee.contact_id AND cr.status = 'sent'
         WHERE ee.campaign_id = $1 AND ee.type = 'click' AND ee.url IS NOT NULL
       ) u
     ),
     g AS (
       SELECT url, COUNT(DISTINCT contact_id)::int AS unique_clicks, COUNT(*)::int AS total_clicks,
              COUNT(DISTINCT contact_id) >= $2 AS mostra
       FROM n GROUP BY url
     )
     SELECT url, unique_clicks, total_clicks, TRUE AS mostra, NULL::int AS links FROM g WHERE mostra
     UNION ALL
     SELECT NULL, COUNT(DISTINCT n.contact_id)::int, COUNT(*)::int, FALSE, (SELECT COUNT(*)::int FROM g WHERE NOT mostra)
     FROM n JOIN g ON g.url = n.url AND NOT g.mostra`, [id, MIN_PESSOAS_POR_LINK]);
  const links = grupos.filter(l => l.mostra)
    .sort((a, b) => b.unique_clicks - a.unique_clicks || b.total_clicks - a.total_clicks || (a.url < b.url ? -1 : 1))
    .slice(0, 200)
    .map(({ url, unique_clicks, total_clicks }) => ({ url, unique_clicks, total_clicks }));
  const resto = grupos.find(l => !l.mostra) || { links: 0, unique_clicks: 0, total_clicks: 0 };
  const timeline = await query(
    `SELECT ${inicio} AS period_start,
            to_char(${inicio} AT TIME ZONE '${FUSO}', '${rotulo}') AS period,
            COUNT(DISTINCT ee.contact_id) FILTER (WHERE ee.type = 'open')::int  AS unique_opens,
            COUNT(DISTINCT ee.contact_id) FILTER (WHERE ee.type = 'click')::int AS unique_clicks
     FROM email_events ee
     JOIN campaign_recipients cr
       ON cr.campaign_id = ee.campaign_id AND cr.contact_id = ee.contact_id AND cr.status = 'sent'
     WHERE ee.campaign_id = $1 AND ee.type IN ('open', 'click')
     GROUP BY 1 ORDER BY 1
     LIMIT ${limiteBaldes}`, [id]);
  // O mesmo cálculo das listas do relatório.
  const listas = await query(
      `WITH cr_list AS (
         SELECT DISTINCT lm.list_id, cr.contact_id
         FROM campaign_recipients cr
         JOIN list_members lm ON lm.contact_id = cr.contact_id
         JOIN campaign_lists cl ON cl.list_id = lm.list_id AND cl.campaign_id = cr.campaign_id
         WHERE cr.campaign_id = $1 AND cr.status = 'sent'
       ),
       ee_agg AS (
         SELECT contact_id, bool_or(type = 'open') AS opened, bool_or(type = 'click') AS clicked
         FROM email_events
         WHERE campaign_id = $1 AND type IN ('open', 'click')
         GROUP BY contact_id
       )
       SELECT l.id AS list_id, l.name AS list_name,
              COUNT(DISTINCT cl2.contact_id)::int AS delivered,
              COUNT(DISTINCT CASE WHEN ea.opened  THEN cl2.contact_id END)::int AS unique_opens,
              COUNT(DISTINCT CASE WHEN ea.clicked THEN cl2.contact_id END)::int AS unique_clicks
       FROM campaign_lists cl_base
       JOIN lists l ON l.id = cl_base.list_id
       LEFT JOIN cr_list cl2 ON cl2.list_id = cl_base.list_id
       LEFT JOIN ee_agg ea ON ea.contact_id = cl2.contact_id
       WHERE cl_base.campaign_id = $1
       GROUP BY l.id, l.name
       ORDER BY delivered DESC`, [id]);

  return res.status(200).json({
    campaign: { ...c, ...comTaxas(metricas.get(id)) },
    links,
    other_links: {
      description: `Links clicados por menos de ${MIN_PESSOAS_POR_LINK} pessoas, juntos para não identificar ninguém.`,
      links: resto.links || 0, unique_clicks: resto.unique_clicks, total_clicks: resto.total_clicks,
    },
    timeline: { granularity: granularidade, timezone: FUSO, data: timeline },
    lists: listas.map(l => ({
      ...l,
      open_rate: taxa(l.unique_opens, l.delivered),
      click_rate: taxa(l.unique_clicks, l.delivered),
    })),
  });
}

// GET /api/analytics — o que existe e o que quer dizer cada número. Também
// serve para testar a chave.
function indice() {
  return {
    api: 'Caetano eMKT — estatísticas das campanhas (só leitura)',
    endpoints: {
      'GET /api/analytics/brands': 'Totais de cada marca no período. Parâmetros: range (7d, 30d, 90d, 12m, all; por omissão 12m, como o ecrã Estatísticas) ou from/to; brand_id; format=csv.',
      'GET /api/analytics/campaigns': 'Campanhas enviadas, da mais recente para a mais antiga, com os números de cada uma. Parâmetros: brand_id; range ou from/to (por omissão, todas); limit (até 1000, por omissão 100); offset; format=csv.',
      'GET /api/analytics/campaigns/{id}': 'Uma campanha: números, links clicados, evolução no tempo (granularity=hour ou day) e listas.',
    },
    authentication: 'Cabeçalho Authorization: Bearer <chave pma_…>, ou ?key=<chave> quando a ferramenta não envia cabeçalhos.',
    dates: 'from e to são dias (AAAA-MM-DD) em hora de Lisboa, os dois incluídos, sobre a data de envio. sent_at vem em UTC (ISO 8601); sent_at_local em hora de Lisboa.',
    definitions: {
      total_recipients: 'Destinatários da campanha.',
      delivered: 'Entregues: aceites pelo servidor de envio, sem bounce nem queixa de spam (os "Enviados" do relatório).',
      bounced: 'Devolvidos (bounce).',
      failed: 'Não enviados por erro, e os que depois marcaram o email como spam.',
      suppressed: 'Não enviados por estarem na lista de supressão.',
      unique_opens: 'Pessoas que abriram (uma por pessoa), só entre as entregues, sem aberturas automáticas.',
      total_opens: 'Aberturas registadas, contando repetições.',
      unique_clicks: 'Pessoas que clicaram (uma por pessoa), só entre as entregues, sem cliques automáticos. Inclui os links do rodapé, menos o de cancelamento.',
      total_clicks: 'Cliques registados, contando repetições.',
      unsubscribes: 'Pessoas que cancelaram a subscrição a partir da campanha.',
      spam_complaints: 'Pessoas que marcaram como spam.',
      automated_opens: 'Pessoas com aberturas de agentes automáticos (pré-visualização do Apple Mail, filtros de segurança). Fora das taxas.',
      automated_clicks: 'Pessoas com cliques de analisadores de segurança. Fora das taxas.',
      delivery_rate: 'delivered / total_recipients × 100',
      open_rate: 'unique_opens / delivered × 100',
      click_rate: 'unique_clicks / delivered × 100',
      ctor: 'unique_clicks / unique_opens × 100',
      bounce_rate: 'bounced / (delivered + bounced) × 100',
      unsubscribe_rate: 'unsubscribes / delivered × 100',
      spam_rate: 'spam_complaints / (delivered + spam_complaints) × 100',
    },
    notes: [
      'Só campanhas enviadas (estado sent) de marcas activas.',
      'Os totais de uma marca são a soma das campanhas: quem abre duas campanhas conta nas duas, tal como recebeu duas.',
      'Os links vêm sem os parâmetros (UTM e outros) e sem o fragmento. Um link clicado por menos de 5 pessoas não sai com o endereço: conta em other_links. Um endereço com @ fica só com o domínio.',
      'A evolução no tempo (timeline) conta, como os números da campanha, só destinatários entregues; period_start é o início do período em UTC.',
      'Com offset, uma campanha que acabe de ser enviada entre dois pedidos empurra as outras uma posição: pede tudo de uma vez (limit até 1000) ou junta as páginas pelo id.',
      'Só contagens: a API não devolve contactos. Os links podem conter o que estiver no endereço que a marca usou no email.',
    ],
  };
}

async function responder(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'A API de estatísticas só aceita GET.' });
  }
  const auth = await autenticar(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  try {
    const recurso = String(primeiro(req.query.analytics) || 'index');
    if (recurso === 'index') return res.status(200).json(indice());
    if (recurso === 'brands' || recurso === 'campaigns') {
      const rl = await rateLimit('analytics-pesado', 'global', PESADAS_POR_MINUTO, 60);
      if (!rl.ok) {
        res.setHeader('Retry-After', String(rl.retryAfter));
        return res.status(429).json({ error: `Mais de ${PESADAS_POR_MINUTO} pedidos de marcas ou campanhas no último minuto. Tenta daqui a ${rl.retryAfter} s.` });
      }
    }
    if (recurso === 'brands') return await marcas(req, res);
    if (recurso === 'campaigns') return await campanhas(req, res);
    if (recurso === 'campaign') return await campanha(req, res);
    return res.status(404).json({ error: 'Recurso desconhecido. Ver GET /api/analytics.' });
  } catch (e) {
    if (e.status) {
      if (e.retryAfter) res.setHeader('Retry-After', String(e.retryAfter));
      return res.status(e.status).json({ error: e.message });
    }
    // statement_timeout (lib/db.js, 20 s): um período enorme ou limit=1000
    // sobre anos de histórico. Diz-se o que fazer em vez de um 500 mudo.
    if (e.code === '57014') {
      return res.status(503).json({ error: 'A consulta demorou demasiado. Pede um período mais curto (range ou from/to) ou menos campanhas (limit).' });
    }
    throw e;
  }
}

module.exports = {
  responder, autenticar, gerarChave, hashDaChave, metricasDasCampanhas, paraCsv,
  PREFIXO, FORMATO_CHAVE, JANELAS, CONTADORES, LIMITE_MAXIMO, MIN_PESSOAS_POR_LINK, VAGAS_PESADAS, PESADAS_POR_MINUTO, opcoes,
};
