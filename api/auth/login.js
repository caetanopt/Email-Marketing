const bcrypt = require('bcryptjs');
const { getPool } = require('../../lib/db');
const { signToken, cors } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email e password obrigatórios' });

  const db = getPool();
  const [rows] = await db.query(
    'SELECT id, name, email, password_hash, active FROM users WHERE email = ?',
    [email.toLowerCase().trim()]
  );

  const user = rows[0];
  if (!user || !user.active) return res.status(401).json({ error: 'Credenciais inválidas' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Credenciais inválidas' });

  await db.query('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);

  const [roleRows] = await db.query(
    'SELECT brand_id, role FROM user_brand_roles WHERE user_id = ?',
    [user.id]
  );

  const token = signToken({ id: user.id, email: user.email, name: user.name });

  res.status(200).json({
    token,
    user: { id: user.id, name: user.name, email: user.email },
    brands: roleRows,
  });
};
