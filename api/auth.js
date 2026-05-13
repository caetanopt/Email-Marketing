const bcrypt = require('bcryptjs');
const { query } = require('../lib/db');
const { signToken, requireAuth, cors } = require('../lib/auth');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;

  // POST — login
  if (req.method === 'POST') {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email e password obrigatórios' });

    try {
      const rows = await query(
        'SELECT id, name, email, password_hash, active, default_brand_id FROM users WHERE email = $1',
        [email.toLowerCase().trim()]
      );
      const user = rows[0];
      if (!user || !user.active) return res.status(401).json({ error: 'Credenciais inválidas' });

      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) return res.status(401).json({ error: 'Credenciais inválidas' });

      await query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

      const brands = await query(
        'SELECT brand_id, role FROM user_brand_roles WHERE user_id = $1', [user.id]
      );

      const token = signToken({ id: user.id, email: user.email, name: user.name });
      return res.status(200).json({
        token,
        user: { id: user.id, name: user.name, email: user.email, default_brand_id: user.default_brand_id || null },
        brands,
      });
    } catch (err) {
      return res.status(500).json({ error: 'Erro de servidor', detail: err.message });
    }
  }

  // GET — utilizador autenticado
  if (req.method === 'GET') {
    const user = requireAuth(req, res);
    if (!user) return;

    try {
      const users = await query(
        'SELECT id, name, email, default_brand_id, created_at, last_login FROM users WHERE id = $1', [user.id]
      );
      if (!users[0]) return res.status(404).json({ error: 'Utilizador não encontrado' });

      const brands = await query(
        `SELECT ubr.brand_id, ubr.role, b.name AS brand_name, b.color
         FROM user_brand_roles ubr
         JOIN brands b ON b.id = ubr.brand_id
         WHERE ubr.user_id = $1 ORDER BY b.name`,
        [user.id]
      );
      return res.status(200).json({ user: users[0], brands });
    } catch (err) {
      return res.status(500).json({ error: 'Erro de servidor', detail: err.message });
    }
  }

  // PUT — update user profile (default_brand_id, name)
  if (req.method === 'PUT') {
    const user = requireAuth(req, res);
    if (!user) return;
    const { default_brand_id } = req.body || {};
    try {
      await query(
        'UPDATE users SET default_brand_id = $1 WHERE id = $2',
        [default_brand_id || null, user.id]
      );
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: 'Erro de servidor', detail: err.message });
    }
  }

  res.status(405).json({ error: 'Método não permitido' });
};
