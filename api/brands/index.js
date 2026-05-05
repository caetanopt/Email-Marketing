const { query } = require('../../lib/db');
const { requireAuth, cors } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  const user = requireAuth(req, res);
  if (!user) return;

  if (req.method !== 'GET') return res.status(405).json({ error: 'Método não permitido' });

  try {
    const rows = await query(
      `SELECT b.id, b.name, b.color, b.logo_url, b.from_name, b.from_email, ubr.role
       FROM brands b
       JOIN user_brand_roles ubr ON ubr.brand_id = b.id AND ubr.user_id = $1
       WHERE b.active = TRUE ORDER BY b.name`,
      [user.id]
    );
    res.status(200).json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: 'Erro de servidor', detail: err.message });
  }
};
