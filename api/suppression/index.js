const { getPool } = require('../../lib/db');
const { requireAuth, cors } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  const user = requireAuth(req, res);
  if (!user) return;

  const { brand_id, search, page = 1, limit = 50 } = req.query;
  if (!brand_id) return res.status(400).json({ error: 'brand_id obrigatório' });

  const db = getPool();

  if (req.method === 'GET') {
    const params = [brand_id];
    let where = 'WHERE brand_id = ?';
    if (search) { where += ' AND email LIKE ?'; params.push(`%${search}%`); }
    const [rows] = await db.query(
      `SELECT id, email, reason, created_at FROM suppression ${where}
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), (parseInt(page) - 1) * parseInt(limit)]
    );
    return res.status(200).json({ data: rows });
  }

  if (req.method === 'POST') {
    const { email, reason } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Email obrigatório' });
    await db.query(
      'INSERT IGNORE INTO suppression (brand_id, email, reason) VALUES (?,?,?)',
      [brand_id, email.toLowerCase().trim(), reason || 'manual']
    );
    await db.query(
      "UPDATE contacts SET status='suppressed' WHERE brand_id=? AND email=?",
      [brand_id, email.toLowerCase().trim()]
    );
    return res.status(201).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Email obrigatório' });
    await db.query('DELETE FROM suppression WHERE brand_id=? AND email=?',
      [brand_id, email.toLowerCase().trim()]);
    return res.status(200).json({ ok: true });
  }

  res.status(405).json({ error: 'Método não permitido' });
};
