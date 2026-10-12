const crypto = require('crypto');
const { query } = require('./db');

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
    spam_rate: taxa(m.spam_complaints, m.delivered),
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
async function metricasDasCampanhas(ids) {
  const mapa = new Map(ids.map(id => [id, vazio()]));
  if (!ids.length) return mapa;
  const [rc, ev] = await Promise.all([
    query(
      `SELECT campaign_id,
              COUNT(*)::int                                     AS total_recipients,
              COUNT(*) FILTER (WHERE status='sent')::int        AS delivered,
              COUNT(*) FILTER (WHERE status='bounced')::int     AS bounced,
              COUNT(*) FILTER (WHERE status='failed')::int      AS failed,
              COUNT(*) FILTER (WHERE status='suppressed')::int  AS suppressed
       FROM campaign_recipients
       WHERE campaign_id = ANY($1::int[])
       GROUP BY campaign_id`, [ids]),
    query(
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
       WHERE ee.campaign_id = ANY($1::int[])
         AND ee.type::text IN ('open','click','unsubscribe','spam','open_auto','click_auto')
       GROUP BY ee.campaign_id`, [ids]),
  ]);
  for (const linha of [...rc, ...ev]) {
    const m = mapa.get(linha.campaign_id);
    if (!m) continue;
    for (const k of CONTADORES) if (linha[k] != null) m[k] = linha[k];
  }
  return mapa;
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

  const [listaMarcas, enviadas] = await Promise.all([
    query(`SELECT b.id, b.name FROM brands b WHERE b.active = TRUE${marca ? ' AND b.id = $1' : ''} ORDER BY b.name`, marca ? [marca] : []),
    query(
      `SELECT c.id, c.brand_id
       FROM campaigns c JOIN brands b ON b.id = c.brand_id
       WHERE c.status = 'sent' AND b.active = TRUE${periodoSql}${marcaSql}`, params),
  ]);
  if (marca && !listaMarcas.length) throw erroDoPedido('Marca não encontrada (ou inactiva).', 404);

  const metricas = await metricasDasCampanhas(enviadas.map(c => c.id));
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

  const linhas = await query(
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
    const [r] = await query(
      `SELECT COUNT(*)::int AS n FROM campaigns c JOIN brands b ON b.id = c.brand_id
       WHERE c.status = 'sent' AND b.active = TRUE${periodoSql}${marcaSql}`, params.slice(0, -2));
    total = r?.n || 0;
  }

  const metricas = await metricasDasCampanhas(linhas.map(c => c.id));
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
  // dia: até um ano. Em hora de Lisboa.
  const balde = granularidade === 'day'
    ? `to_char(date_trunc('day', created_at AT TIME ZONE '${FUSO}'), 'YYYY-MM-DD')`
    : `to_char(date_trunc('hour', created_at AT TIME ZONE '${FUSO}'), 'YYYY-MM-DD HH24:00')`;
  const limiteBaldes = granularidade === 'day' ? 366 : 168;

  const [metricas, links, timeline, listas] = await Promise.all([
    metricasDasCampanhas([id]),
    // Sem a query string nem o fragmento: os UTM partiam o mesmo link em
    // vários, e um template pode montar links com dados da pessoa.
    query(
      `SELECT split_part(split_part(ee.url, '#', 1), '?', 1) AS url,
              COUNT(DISTINCT ee.contact_id)::int AS unique_clicks,
              COUNT(*)::int                      AS total_clicks
       FROM email_events ee
       JOIN campaign_recipients cr
         ON cr.campaign_id = ee.campaign_id AND cr.contact_id = ee.contact_id AND cr.status = 'sent'
       WHERE ee.campaign_id = $1 AND ee.type = 'click' AND ee.url IS NOT NULL
       GROUP BY 1
       ORDER BY unique_clicks DESC, total_clicks DESC, url
       LIMIT 200`, [id]),
    query(
      `SELECT ${balde} AS period,
              COUNT(DISTINCT contact_id) FILTER (WHERE type = 'open')::int  AS unique_opens,
              COUNT(DISTINCT contact_id) FILTER (WHERE type = 'click')::int AS unique_clicks
       FROM email_events
       WHERE campaign_id = $1 AND type IN ('open', 'click')
       GROUP BY 1 ORDER BY 1
       LIMIT ${limiteBaldes}`, [id]),
    // O mesmo cálculo das listas do relatório.
    query(
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
       ORDER BY delivered DESC`, [id]),
  ]);

  return res.status(200).json({
    campaign: { ...c, ...comTaxas(metricas.get(id)) },
    links,
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
      spam_rate: 'spam_complaints / delivered × 100',
    },
    notes: [
      'Só campanhas enviadas (estado sent) de marcas activas.',
      'Os totais de uma marca são a soma das campanhas: quem abre duas campanhas conta nas duas, tal como recebeu duas.',
      'Os links vêm sem os parâmetros (UTM e outros) e sem o fragmento.',
      'Não há dados pessoais nesta API: só contagens.',
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
    if (recurso === 'brands') return await marcas(req, res);
    if (recurso === 'campaigns') return await campanhas(req, res);
    if (recurso === 'campaign') return await campanha(req, res);
    return res.status(404).json({ error: 'Recurso desconhecido. Ver GET /api/analytics.' });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
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
  PREFIXO, FORMATO_CHAVE, JANELAS, CONTADORES, LIMITE_MAXIMO,
};
