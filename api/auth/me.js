const { getPool } = require('../../lib/db');
const { requireAuth, cors } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método não permitido' });

  const user = requireAuth(req, res);
  if (!user) return;

  const db = getPool();
  const [users] = await db.query(
    'SELECT id, name, email, created_at, last_login FROM users WHERE id = ?',
    [user.id]
  );
  if (!users[0]) return res.status(404).json({ error: 'Utilizador não encontrado' });

  const [roles] = await db.query(
    `SELECT ubr.brand_id, ubr.role, b.name AS brand_name, b.color
     FROM user_brand_roles ubr
     JOIN brands b ON b.id = ubr.brand_id
     WHERE ubr.user_id = ?
     ORDER BY b.name`,
    [user.id]
  );

  res.status(200).json({ user: users[0], brands: roles });
};
