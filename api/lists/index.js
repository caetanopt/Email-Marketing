const { getPool } = require('../../lib/db');
const { requireAuth, cors } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  const user = requireAuth(req, res);
  if (!user) return;

  const { brand_id } = req.query;
  if (!brand_id) return res.status(400).json({ error: 'brand_id obrigatório' });

  const db = getPool();

  if (req.method === 'GET') {
    const [rows] = await db.query(
      `SELECT l.id, l.name, l.description, l.created_at,
              COUNT(lm.contact_id) AS total_contacts
       FROM lists l
       LEFT JOIN list_members lm ON lm.list_id = l.id
       WHERE l.brand_id = ?
       GROUP BY l.id
       ORDER BY l.name`,
      [brand_id]
    );
    return res.status(200).json({ data: rows });
  }

  if (req.method === 'POST') {
    const { name, description } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Nome obrigatório' });
    const [result] = await db.query(
      'INSERT INTO lists (brand_id, name, description) VALUES (?, ?, ?)',
      [brand_id, name, description || null]
    );
    return res.status(201).json({ id: result.insertId, name });
  }

  res.status(405).json({ error: 'Método não permitido' });
};
