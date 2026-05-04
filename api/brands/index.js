const { getPool } = require('../../lib/db');
const { requireAuth, cors } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  const user = requireAuth(req, res);
  if (!user) return;

  const db = getPool();

  if (req.method === 'GET') {
    const [rows] = await db.query(
      `SELECT b.id, b.name, b.color, b.logo_url, b.from_name, b.from_email, ubr.role
       FROM brands b
       JOIN user_brand_roles ubr ON ubr.brand_id = b.id AND ubr.user_id = ?
       WHERE b.active = 1
       ORDER BY b.name`,
      [user.id]
    );
    return res.status(200).json({ data: rows });
  }

  res.status(405).json({ error: 'Método não permitido' });
};
