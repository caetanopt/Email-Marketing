const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  console.error('FATAL: JWT_SECRET env var is missing — set it in Vercel project settings.');
  throw new Error('JWT_SECRET not configured');
}

function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: '7d' });
}

function verifyToken(token) {
  return jwt.verify(token, SECRET);
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

module.exports = { signToken, verifyToken, requireAuth, cors, withAuth };
