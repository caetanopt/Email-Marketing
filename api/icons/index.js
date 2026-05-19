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
      try {
        const rows = await query(
          `SELECT id, brand_id, name, mime_type, data_url, created_at
           FROM custom_icons
           WHERE brand_id = $1 OR brand_id IS NULL
           ORDER BY brand_id NULLS LAST, created_at DESC`,
          [brand_id]
        );
        return res.status(200).json({ data: rows });
      } catch (e) {
        if (e.code === '42P01') return res.status(200).json({ data: [], _migration_pending: true });
        throw e;
      }
    }

    if (req.method === 'POST') {
      const { name, data_url, mime_type, scope } = req.body || {};
      if (!name) return res.status(400).json({ error: 'name obrigatório' });
      if (!data_url) return res.status(400).json({ error: 'data_url obrigatório' });
      if (data_url.length > 400000) return res.status(400).json({ error: 'Ficheiro demasiado grande (máx ~300 KB)' });
      const targetBrandId = scope === 'global' ? null : brand_id;
      const rows = await query(
        `INSERT INTO custom_icons (brand_id, name, mime_type, data_url, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
        [targetBrandId, name.substring(0, 255), mime_type || 'image/svg+xml', data_url, user.id]
      );
      return res.status(201).json({ id: rows[0].id, created_at: rows[0].created_at });
    }

    res.status(405).json({ error: 'Método não permitido' });
  } catch (err) {
    res.status(500).json({ error: 'Erro de servidor', detail: err.message });
  }
};
