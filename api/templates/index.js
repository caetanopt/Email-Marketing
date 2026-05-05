const { query } = require('../../lib/db');
const { requireAuth, cors } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  const user = requireAuth(req, res);
  if (!user) return;

  const { brand_id } = req.query;
  if (!brand_id) return res.status(400).json({ error: 'brand_id obrigatório' });

  try {
    if (req.method === 'GET') {
      const rows = await query(
        'SELECT id, name, subject, preview_text, created_at, updated_at FROM templates WHERE brand_id=$1 ORDER BY updated_at DESC',
        [brand_id]
      );
      return res.status(200).json({ data: rows });
    }

    if (req.method === 'POST') {
      const { name, subject, preview_text, html_content } = req.body || {};
      if (!name) return res.status(400).json({ error: 'Nome obrigatório' });
      const rows = await query(
        'INSERT INTO templates (brand_id, name, subject, preview_text, html_content, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
        [brand_id, name, subject||null, preview_text||null, html_content||'', user.id]
      );
      return res.status(201).json({ id: rows[0].id, name });
    }

    res.status(405).json({ error: 'Método não permitido' });
  } catch (err) {
    res.status(500).json({ error: 'Erro de servidor', detail: err.message });
  }
};
