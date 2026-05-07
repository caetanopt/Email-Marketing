const { query } = require('../../lib/db');
const { requireAuth, cors } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  const user = requireAuth(req, res);
  if (!user) return;

  const { id, brand_id } = req.query;

  try {
    if (req.method === 'GET') {
      if (!brand_id) return res.status(400).json({ error: 'brand_id obrigatório' });
      try {
        const rows = await query(
          `SELECT id, brand_id, name, url, mime_type, is_shared, created_at, updated_at
           FROM media
           WHERE brand_id = $1 OR is_shared = TRUE
           ORDER BY created_at DESC`,
          [brand_id]
        );
        return res.status(200).json({ data: rows });
      } catch (e) {
        if (e.code === '42P01') return res.status(200).json({ data: [], _migration_pending: true });
        throw e;
      }
    }

    if (req.method === 'POST') {
      const { brand_id: bId, name, url, mime_type, is_shared } = req.body || {};
      if (!bId) return res.status(400).json({ error: 'brand_id obrigatório' });
      if (!name || !url) return res.status(400).json({ error: 'name e url obrigatórios' });
      try {
        const r = await query(
          `INSERT INTO media (brand_id, name, url, mime_type, is_shared, created_by)
           VALUES ($1,$2,$3,$4,$5,$6)
           RETURNING id, brand_id, name, url, mime_type, is_shared, created_at, updated_at`,
          [bId, name, url, mime_type || null, !!is_shared, user.id]
        );
        return res.status(201).json(r[0]);
      } catch (e) {
        if (e.code === '42P01') return res.status(503).json({ error: 'Migração em falta: corre 008_media.sql no Supabase.' });
        throw e;
      }
    }

    if (req.method === 'PUT' && id) {
      const body = req.body || {};
      const sets = [];
      const params = [];
      for (const f of ['name', 'is_shared']) {
        if (Object.prototype.hasOwnProperty.call(body, f)) {
          params.push(body[f]);
          sets.push(`${f}=$${params.length}`);
        }
      }
      if (!sets.length) return res.status(200).json({ ok: true });
      sets.push(`updated_at=NOW()`);
      params.push(id);
      try {
        await query(`UPDATE media SET ${sets.join(', ')} WHERE id=$${params.length}`, params);
        return res.status(200).json({ ok: true });
      } catch (e) {
        if (e.code === '42P01') return res.status(503).json({ error: 'Migração em falta: corre 008_media.sql no Supabase.' });
        throw e;
      }
    }

    if (req.method === 'DELETE' && id) {
      try {
        await query('DELETE FROM media WHERE id=$1', [id]);
        return res.status(200).json({ ok: true });
      } catch (e) {
        if (e.code === '42P01') return res.status(503).json({ error: 'Migração em falta: corre 008_media.sql no Supabase.' });
        throw e;
      }
    }

    res.status(405).json({ error: 'Método não permitido' });
  } catch (err) {
    res.status(500).json({ error: 'Erro de servidor', detail: err.message });
  }
};
