const { query } = require('../../lib/db');
const { requireAuth, cors } = require('../../lib/auth');

async function authorizeTemplate(userId, templateId) {
  const r = await query(
    `SELECT t.*
     FROM templates t
     JOIN user_brand_roles ubr ON ubr.brand_id = t.brand_id AND ubr.user_id = $2
     WHERE t.id = $1`,
    [templateId, userId]
  );
  return r[0] || null;
}
async function authorizeBrand(userId, brandId) {
  const r = await query('SELECT 1 FROM user_brand_roles WHERE user_id=$1 AND brand_id=$2', [userId, brandId]);
  return r.length > 0;
}

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  const user = requireAuth(req, res);
  if (!user) return;

  const { brand_id, id, target_brand_id } = req.query;

  // Operations on a specific template (id present)
  if (id) {
    try {
      const tpl = await authorizeTemplate(user.id, id);
      if (!tpl) return res.status(404).json({ error: 'Template não encontrado' });

      if (req.method === 'GET') return res.status(200).json(tpl);

      if (req.method === 'PUT') {
        const { name, subject, preview_text, html_content } = req.body || {};
        await query(
          'UPDATE templates SET name=COALESCE($1,name), subject=$2, preview_text=$3, html_content=COALESCE($4,html_content), updated_at=NOW() WHERE id=$5 AND brand_id=$6',
          [name||null, subject||null, preview_text||null, html_content||null, id, tpl.brand_id]
        );
        return res.status(200).json({ ok: true });
      }

      if (req.method === 'DELETE') {
        await query('DELETE FROM templates WHERE id=$1 AND brand_id=$2', [id, tpl.brand_id]);
        return res.status(200).json({ ok: true });
      }

      if (req.method === 'POST') {
        if (!target_brand_id) return res.status(400).json({ error: 'target_brand_id obrigatório' });
        if (!await authorizeBrand(user.id, target_brand_id)) return res.status(403).json({ error: 'Sem permissão na marca destino' });
        const rows = await query(
          'INSERT INTO templates (brand_id, name, subject, preview_text, html_content, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
          [target_brand_id, `${tpl.name} (cópia)`, tpl.subject, tpl.preview_text, tpl.html_content, user.id]
        );
        return res.status(201).json({ id: rows[0].id });
      }

      return res.status(405).json({ error: 'Método não permitido' });
    } catch (err) {
      return res.status(500).json({ error: 'Erro de servidor', detail: err.message });
    }
  }

  // Operations on the collection (brand_id required)
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
