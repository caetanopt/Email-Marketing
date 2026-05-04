const { getPool } = require('../../lib/db');
const { requireAuth, cors } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  const user = requireAuth(req, res);
  if (!user) return;

  const { id, target_brand_id } = req.query;
  const db = getPool();

  if (req.method === 'GET') {
    const [[tpl]] = await db.query('SELECT * FROM templates WHERE id = ?', [id]);
    if (!tpl) return res.status(404).json({ error: 'Template não encontrado' });
    return res.status(200).json(tpl);
  }

  if (req.method === 'PUT') {
    const { name, subject, preview_text, html_content } = req.body || {};
    await db.query(
      'UPDATE templates SET name=COALESCE(?,name), subject=?, preview_text=?, html_content=COALESCE(?,html_content) WHERE id=?',
      [name || null, subject || null, preview_text || null, html_content || null, id]
    );
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    await db.query('DELETE FROM templates WHERE id=?', [id]);
    return res.status(200).json({ ok: true });
  }

  // POST = duplicate to another brand
  if (req.method === 'POST') {
    if (!target_brand_id) return res.status(400).json({ error: 'target_brand_id obrigatório' });
    const [[tpl]] = await db.query('SELECT * FROM templates WHERE id=?', [id]);
    if (!tpl) return res.status(404).json({ error: 'Template não encontrado' });
    const [result] = await db.query(
      'INSERT INTO templates (brand_id, name, subject, preview_text, html_content, created_by) VALUES (?,?,?,?,?,?)',
      [target_brand_id, `${tpl.name} (cópia)`, tpl.subject, tpl.preview_text, tpl.html_content, user.id]
    );
    return res.status(201).json({ id: result.insertId });
  }

  res.status(405).json({ error: 'Método não permitido' });
};
