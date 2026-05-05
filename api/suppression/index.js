const { query } = require('../../lib/db');
const { requireAuth, cors } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  const user = requireAuth(req, res);
  if (!user) return;

  const { brand_id, search, page = 1, limit = 50 } = req.query;
  if (!brand_id) return res.status(400).json({ error: 'brand_id obrigatório' });

  try {
    if (req.method === 'GET') {
      const params = [brand_id];
      let where = 'WHERE brand_id=$1';
      if (search) { params.push(`%${search}%`); where += ` AND email ILIKE $${params.length}`; }
      params.push(parseInt(limit));
      params.push((parseInt(page) - 1) * parseInt(limit));
      const rows = await query(
        `SELECT id, email, reason, created_at FROM suppression ${where}
         ORDER BY created_at DESC LIMIT $${params.length-1} OFFSET $${params.length}`,
        params
      );
      return res.status(200).json({ data: rows });
    }

    if (req.method === 'POST') {
      const { email, reason } = req.body || {};
      if (!email) return res.status(400).json({ error: 'Email obrigatório' });
      const e = email.toLowerCase().trim();
      await query(
        'INSERT INTO suppression (brand_id, email, reason) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [brand_id, e, reason||'manual']
      );
      await query("UPDATE contacts SET status='suppressed' WHERE brand_id=$1 AND email=$2", [brand_id, e]);
      return res.status(201).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const { email } = req.body || {};
      if (!email) return res.status(400).json({ error: 'Email obrigatório' });
      await query('DELETE FROM suppression WHERE brand_id=$1 AND email=$2',
        [brand_id, email.toLowerCase().trim()]);
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: 'Método não permitido' });
  } catch (err) {
    res.status(500).json({ error: 'Erro de servidor', detail: err.message });
  }
};
