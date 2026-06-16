const { query } = require('../../lib/db');
const { withAuth, requireBrand } = require('../../lib/auth');

module.exports = withAuth(async (req, res, user) => {

  const { brand_id, id } = req.query;

  // DELETE /api/icons?id=X
  if (req.method === 'DELETE') {
    if (!id) return res.status(400).json({ error: 'id obrigatório' });
    try {
      const rows = await query(
        `DELETE FROM custom_icons
         WHERE id = $1
           AND (created_by = $2
                OR brand_id IN (SELECT brand_id FROM user_brand_roles WHERE user_id = $2)
                OR brand_id IS NULL)
         RETURNING id`,
        [id, user.id]
      );
      if (!rows.length) return res.status(404).json({ error: 'Ícone não encontrado ou sem permissão' });
      return res.status(200).json({ ok: true });
    } catch (e) {
      if (e.code === '42P01') return res.status(503).json({ error: 'Migração em falta: corre 020_custom_icons.sql' });
      return res.status(500).json({ error: 'Erro de servidor' });
    }
  }

  if (!brand_id) return res.status(400).json({ error: 'brand_id obrigatório' });
  if (!await requireBrand(req, res, user.id, brand_id)) return;

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
      // SVG não é suportado pela maioria dos clientes de email — rejeitar.
      if ((mime_type && /svg/i.test(mime_type)) || /^data:image\/svg/i.test(data_url)) {
        return res.status(400).json({ error: 'SVG não é suportado em emails. Usa PNG, JPG ou WebP.' });
      }
      const targetBrandId = scope === 'global' ? null : brand_id;
      const rows = await query(
        `INSERT INTO custom_icons (brand_id, name, mime_type, data_url, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
        [targetBrandId, name.substring(0, 255), mime_type || 'image/png', data_url, user.id]
      );
      return res.status(201).json({ id: rows[0].id, created_at: rows[0].created_at });
    }

    res.status(405).json({ error: 'Método não permitido' });
  } catch (err) {
    res.status(500).json({ error: 'Erro de servidor' });
  }
});
