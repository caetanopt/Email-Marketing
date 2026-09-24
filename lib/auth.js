const jwt = require('jsonwebtoken');
const { query } = require('./db');

const SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  console.error('FATAL: JWT_SECRET env var is missing — set it in Vercel project settings.');
  throw new Error('JWT_SECRET not configured');
}

// ── Sessão semanal ─────────────────────────────────────────────────────────
//
// Uma sessão vale até ao fim da semana em que foi aberta: à segunda-feira às
// 00:00 de Lisboa termina, e é preciso pedir um link novo. Era de 7 dias a
// contar do login no servidor, e de um dia de calendário (UTC) no browser — a
// regra que o utilizador via era a do browser, que o servidor não conhecia:
// um token copiado continuava a abrir a API durante os 7 dias.
//
// A semana conta-se na hora de Lisboa, não em UTC nem na hora do servidor da
// Vercel. A mudança de hora (último domingo de Março e de Outubro, à 01:00
// UTC) nunca coincide com a meia-noite de segunda, mas muda o desvio — por
// isso a meia-noite de segunda é convertida com o desvio desse instante, e
// uma semana pode ter 167 ou 169 horas.
const FUSO_DA_SESSAO = 'Europe/Lisbon';
const _fmtFuso = new Intl.DateTimeFormat('en-GB', {
  timeZone: FUSO_DA_SESSAO, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
});

// Relógio de parede em Lisboa no instante `t` (ms UTC).
function _paredeEmLisboa(t) {
  const p = {};
  for (const { type, value } of _fmtFuso.formatToParts(new Date(t))) p[type] = value;
  return {
    ano: +p.year, mes: +p.month, dia: +p.day,
    hora: +p.hour, min: +p.minute, seg: +p.second,
    // 0 = segunda … 6 = domingo
    diaDaSemana: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday),
  };
}

// Instante UTC (ms) em que é 00:00 de ano/mes/dia em Lisboa.
function _meiaNoiteEmLisboa(ano, mes, dia) {
  const comoSeFosseUtc = Date.UTC(ano, mes - 1, dia, 0, 0, 0);
  const desvio = (t) => {
    const w = _paredeEmLisboa(t);
    return Date.UTC(w.ano, w.mes - 1, w.dia, w.hora, w.min, w.seg) - t;
  };
  // Duas passagens: a primeira estimativa usa o desvio do instante errado; a
  // segunda corrige-o se a estimativa caiu do outro lado de uma mudança de hora.
  const t1 = comoSeFosseUtc - desvio(comoSeFosseUtc);
  return comoSeFosseUtc - desvio(t1);
}

// Início (segunda 00:00 de Lisboa) da semana que contém `agora`, em ms UTC.
function inicioDaSemana(agora = Date.now()) {
  const w = _paredeEmLisboa(agora);
  // Aritmética de calendário em UTC puro: só se mexe na data, não na hora.
  const segunda = new Date(Date.UTC(w.ano, w.mes - 1, w.dia - w.diaDaSemana));
  return _meiaNoiteEmLisboa(segunda.getUTCFullYear(), segunda.getUTCMonth() + 1, segunda.getUTCDate());
}

// Fim da semana que contém `agora`: a segunda-feira seguinte às 00:00.
function fimDaSemana(agora = Date.now()) {
  const w = _paredeEmLisboa(agora);
  const proxima = new Date(Date.UTC(w.ano, w.mes - 1, w.dia - w.diaDaSemana + 7));
  return _meiaNoiteEmLisboa(proxima.getUTCFullYear(), proxima.getUTCMonth() + 1, proxima.getUTCDate());
}

function signToken(payload) {
  // `exp` explícito em vez de expiresIn: a validade não é uma duração fixa,
  // é até uma hora certa. jsonwebtoken recusa receber as duas coisas.
  return jwt.sign({ ...payload, exp: Math.floor(fimDaSemana() / 1000) }, SECRET, { algorithm: 'HS256' });
}

function verifyToken(token) {
  return jwt.verify(token, SECRET, { algorithms: ['HS256'] });
}

// S-3: requireAuth passou a ser assíncrono. Além de verificar a assinatura do
// token, revalida contra a BD — utilizador activo e token_version igual à do
// token. Um utilizador desactivado, apagado, ou cuja sessão foi revogada
// (token_version incrementado) é recusado no pedido seguinte, sem esperar pelo
// fim da semana. Todos os handlers fazem `await requireAuth(...)`.
async function requireAuth(req, res) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Não autenticado' });
    return null;
  }
  let payload;
  try {
    payload = verifyToken(auth.slice(7));
  } catch {
    res.status(401).json({ error: 'Token inválido ou expirado' });
    return null;
  }
  // Sessão de uma semana anterior. O `exp` dos tokens novos já termina à
  // segunda-feira; isto apanha os que foram emitidos com a regra antiga dos 7
  // dias (um login de sexta valeria até à sexta seguinte) e qualquer token sem
  // `iat`. Não depende da base de dados, por isso vale mesmo quando ela falha.
  if (!payload.iat || payload.iat * 1000 < inicioDaSemana()) {
    res.status(401).json({ error: 'A sessão desta semana terminou. Pede um novo link de acesso.' });
    return null;
  }
  // Revalidação na BD. Distingue-se com cuidado:
  //   • utilizador em falta / inactivo / token_version diferente → 401 (revogado)
  //   • coluna token_version ainda não existe (migração por correr) → valida só active
  //   • erro de ligação à BD → concede (o token é válido); um blip de BD não pode
  //     expulsar toda a gente, e a janela de revogação perdida é de segundos.
  try {
    const r = await query('SELECT active, token_version FROM users WHERE id=$1', [payload.id]);
    const u = r[0];
    if (!u || u.active === false) {
      res.status(401).json({ error: 'Sessão terminada. Inicia sessão outra vez.' });
      return null;
    }
    if (payload.tv != null && u.token_version != null && Number(payload.tv) !== Number(u.token_version)) {
      res.status(401).json({ error: 'Sessão terminada. Inicia sessão outra vez.' });
      return null;
    }
  } catch (e) {
    if (e.code === '42703') {
      try {
        const r = await query('SELECT active FROM users WHERE id=$1', [payload.id]);
        if (!r[0] || r[0].active === false) {
          res.status(401).json({ error: 'Sessão terminada. Inicia sessão outra vez.' });
          return null;
        }
      } catch (_) { /* mesma política de disponibilidade abaixo */ }
    } else {
      console.warn('requireAuth: revalidação falhou, a conceder por disponibilidade:', e.message);
    }
  }
  return payload;
}

// Confirma que o utilizador tem um papel na marca indicada. Usar em todos os
// endpoints que recebem brand_id do cliente, para impedir acesso entre marcas.
async function hasBrandAccess(userId, brandId) {
  if (!brandId) return false;
  const r = await query(
    'SELECT 1 FROM user_brand_roles WHERE user_id=$1 AND brand_id=$2 LIMIT 1',
    [userId, brandId]
  );
  return !!r[0];
}

// Confirma que o utilizador tem papel em alguma marca. É a verificação que
// serve os recursos globais — listas e contactos —, que não pertencem a
// nenhuma marca mas continuam a ser só para quem tem acesso à aplicação.
async function hasAnyRole(userId) {
  const r = await query(
    'SELECT 1 FROM user_brand_roles WHERE user_id=$1 LIMIT 1',
    [userId]
  );
  return !!r[0];
}

// Helper de conveniência: valida o acesso e, se falhar, responde 403 e devolve
// false (o handler deve fazer `if (!await requireBrand(...)) return;`).
async function requireBrand(req, res, userId, brandId) {
  if (await hasBrandAccess(userId, brandId)) return true;
  res.status(403).json({ error: 'Acesso negado a esta marca' });
  return false;
}

// ── Autorização de ESCRITA (S-8) ─────────────────────────────────────────
// hasBrandAccess só confirma que o utilizador tem ALGUM papel na marca — e um
// viewer também tem. O frontend esconde os botões de escrita a viewers, mas
// isso é cosmético: com o token, um viewer podia chamar POST/PUT/DELETE
// directamente. Estas verificações fecham isso no servidor, que é onde conta.

// Papel do utilizador numa marca (owner/editor/viewer), ou null se não tiver.
async function roleInBrand(userId, brandId) {
  if (!brandId) return null;
  const r = await query(
    'SELECT role FROM user_brand_roles WHERE user_id=$1 AND brand_id=$2 LIMIT 1',
    [userId, brandId]
  );
  return r[0] ? r[0].role : null;
}

// Escrever numa marca exige owner ou editor. Um viewer é só leitura.
// `if (!await requireWrite(req, res, user.id, brandId)) return;`
async function requireWrite(req, res, userId, brandId) {
  const role = await roleInBrand(userId, brandId);
  if (role === 'owner' || role === 'editor') return true;
  res.status(403).json({ error: 'Apenas leitura: o teu papel nesta marca não permite esta acção.' });
  return false;
}

// Contactos e listas são globais (sem marca). Escrever neles exige owner ou
// editor em ALGUMA marca — um viewer em todas as marcas não escreve.
async function requireWriteAny(req, res, userId) {
  const r = await query(
    "SELECT 1 FROM user_brand_roles WHERE user_id=$1 AND role IN ('owner','editor') LIMIT 1",
    [userId]
  );
  if (r[0]) return true;
  res.status(403).json({ error: 'Apenas leitura: a tua conta não permite esta acção.' });
  return false;
}

function cors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return true; }
  return false;
}

function withAuth(handler) {
  return async (req, res) => {
    if (cors(req, res)) return;
    const user = await requireAuth(req, res);
    if (!user) return;
    return handler(req, res, user);
  };
}

module.exports = { signToken, verifyToken, requireAuth, cors, withAuth, hasBrandAccess, hasAnyRole, requireBrand, roleInBrand, requireWrite, requireWriteAny, inicioDaSemana, fimDaSemana };
