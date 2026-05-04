const bcrypt = require('bcryptjs');
const { getPool } = require('../lib/db');
const { signToken, requireAuth, cors } = require('../lib/auth');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;

  // POST /api/auth?action=login
  if (req.method === 'POST') {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email e password obrigatórios' });

    try {
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
        'SELECT brand_id, role FROM user_brand_roles WHERE user_id = ?', [user.id]
      );

      const token = signToken({ id: user.id, email: user.email, name: user.name });
      return res.status(200).json({
        token,
        user: { id: user.id, name: user.name, email: user.email },
        brands: roleRows,
      });
    } catch (err) {
      return res.status(500).json({ error: 'Erro de servidor', detail: err.message });
    }
  }

  // GET /api/auth — devolve utilizador autenticado
  if (req.method === 'GET') {
    const user = requireAuth(req, res);
    if (!user) return;

    try {
      const db = getPool();
      const [users] = await db.query(
        'SELECT id, name, email, created_at, last_login FROM users WHERE id = ?', [user.id]
      );
      if (!users[0]) return res.status(404).json({ error: 'Utilizador não encontrado' });

      const [roles] = await db.query(
        `SELECT ubr.brand_id, ubr.role, b.name AS brand_name, b.color
         FROM user_brand_roles ubr
         JOIN brands b ON b.id = ubr.brand_id
         WHERE ubr.user_id = ? ORDER BY b.name`,
        [user.id]
      );
      return res.status(200).json({ user: users[0], brands: roles });
    } catch (err) {
      return res.status(500).json({ error: 'Erro de servidor', detail: err.message });
    }
  }

  res.status(405).json({ error: 'Método não permitido' });
};
