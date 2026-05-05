const { query } = require('../../lib/db');
const { requireAuth, cors } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  const user = requireAuth(req, res);
  if (!user) return;

  const { id, target_brand_id } = req.query;

  try {
    if (req.method === 'GET') {
      const rows = await query('SELECT * FROM templates WHERE id=$1', [id]);
      if (!rows[0]) return res.status(404).json({ error: 'Template não encontrado' });
      return res.status(200).json(rows[0]);
    }

    if (req.method === 'PUT') {
      const { name, subject, preview_text, html_content } = req.body || {};
      await query(
        'UPDATE templates SET name=COALESCE($1,name), subject=$2, preview_text=$3, html_content=COALESCE($4,html_content), updated_at=NOW() WHERE id=$5',
        [name||null, subject||null, preview_text||null, html_content||null, id]
      );
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      await query('DELETE FROM templates WHERE id=$1', [id]);
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'POST') {
      if (!target_brand_id) return res.status(400).json({ error: 'target_brand_id obrigatório' });
      const src = await query('SELECT * FROM templates WHERE id=$1', [id]);
      if (!src[0]) return res.status(404).json({ error: 'Template não encontrado' });
      const t = src[0];
      const rows = await query(
        'INSERT INTO templates (brand_id, name, subject, preview_text, html_content, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
        [target_brand_id, `${t.name} (cópia)`, t.subject, t.preview_text, t.html_content, user.id]
      );
      return res.status(201).json({ id: rows[0].id });
    }

    res.status(405).json({ error: 'Método não permitido' });
  } catch (err) {
    res.status(500).json({ error: 'Erro de servidor', detail: err.message });
  }
};
