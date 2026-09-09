const jwt = require('jsonwebtoken');
const { query } = require('./db');

const SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  console.error('FATAL: JWT_SECRET env var is missing — set it in Vercel project settings.');
  throw new Error('JWT_SECRET not configured');
}

function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: '7d', algorithm: 'HS256' });
}

function verifyToken(token) {
  return jwt.verify(token, SECRET, { algorithms: ['HS256'] });
}

// S-3: requireAuth passou a ser assíncrono. Além de verificar a assinatura do
// token, revalida contra a BD — utilizador activo e token_version igual à do
// token. Um utilizador desactivado, apagado, ou cuja sessão foi revogada
// (token_version incrementado) é recusado no pedido seguinte, sem esperar pela
// expiração de 7 dias. Todos os handlers fazem `await requireAuth(...)`.
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

module.exports = { signToken, verifyToken, requireAuth, cors, withAuth, hasBrandAccess, hasAnyRole, requireBrand, roleInBrand, requireWrite, requireWriteAny };
