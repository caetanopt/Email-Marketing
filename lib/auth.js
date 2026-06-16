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

function requireAuth(req, res) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Não autenticado' });
    return null;
  }
  try {
    return verifyToken(auth.slice(7));
  } catch {
    res.status(401).json({ error: 'Token inválido ou expirado' });
    return null;
  }
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

// Helper de conveniência: valida o acesso e, se falhar, responde 403 e devolve
// false (o handler deve fazer `if (!await requireBrand(...)) return;`).
async function requireBrand(req, res, userId, brandId) {
  if (await hasBrandAccess(userId, brandId)) return true;
  res.status(403).json({ error: 'Acesso negado a esta marca' });
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
    const user = requireAuth(req, res);
    if (!user) return;
    return handler(req, res, user);
  };
}

module.exports = { signToken, verifyToken, requireAuth, cors, withAuth, hasBrandAccess, requireBrand };
