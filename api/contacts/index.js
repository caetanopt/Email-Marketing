const { query } = require('../../lib/db');
const { requireAuth, cors } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  const user = requireAuth(req, res);
  if (!user) return;

  const { brand_id, search, status, list_id, page = 1, limit = 50, action, import_id } = req.query;
  if (!brand_id) return res.status(400).json({ error: 'brand_id obrigatório' });

  try {
    // ── Imports history ─────────────────────────────────────
    if (action === 'imports') {
      if (req.method === 'GET') {
        try {
          if (import_id) {
            const rows = await query(
              `SELECT i.*, u.name AS created_by_name FROM imports i
               LEFT JOIN users u ON u.id = i.created_by
               WHERE i.id=$1 AND i.brand_id=$2`,
              [import_id, brand_id]
            );
            if (!rows[0]) return res.status(404).json({ error: 'Importação não encontrada' });
            return res.status(200).json(rows[0]);
          }
          const rows = await query(
            `SELECT i.id, i.file_name, i.list_id, i.list_name, i.total_rows,
                    i.imported, i.skipped, i.failed, i.status, i.created_at,
                    u.name AS created_by_name
             FROM imports i LEFT JOIN users u ON u.id = i.created_by
             WHERE i.brand_id=$1 ORDER BY i.created_at DESC LIMIT 50`,
            [brand_id]
          );
          return res.status(200).json({ data: rows });
        } catch (e) {
          if (e.code === '42P01') return res.status(200).json({ data: [], _migration_pending: true });
          throw e;
        }
      }
      if (req.method === 'POST') {
        const { file_name, list_id: lid, list_name, total_rows, imported, skipped, failed, status: st } = req.body || {};
        if (!file_name) return res.status(400).json({ error: 'file_name obrigatório' });
        try {
          const rows = await query(
            `INSERT INTO imports (brand_id, file_name, list_id, list_name, total_rows, imported, skipped, failed, status, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, created_at`,
            [brand_id, file_name, lid || null, list_name || null,
             total_rows||0, imported||0, skipped||0, failed||0,
             st || 'completed', user.id]
          );
          return res.status(201).json({ id: rows[0].id, created_at: rows[0].created_at });
        } catch (e) {
          if (e.code === '42P01') return res.status(503).json({ error: 'Migração em falta: corre 012_imports.sql.' });
          throw e;
        }
      }
      return res.status(405).json({ error: 'Método não permitido' });
    }

    if (req.method === 'GET') {
      const params = [brand_id];
      let join = '', where = 'WHERE c.brand_id = $1';

      if (list_id) {
        params.push(list_id);
        join = `JOIN list_members lm ON lm.contact_id = c.id AND lm.list_id = $${params.length}`;
      }
      if (status)  { params.push(status);         where += ` AND c.status = $${params.length}`; }
      if (search)  { params.push(`%${search}%`);  where += ` AND (c.email ILIKE $${params.length} OR c.name ILIKE $${params.length})`; }

      const countParams = [brand_id];
      let countJoin = '', countWhere = 'WHERE c.brand_id = $1';
      if (list_id)  { countParams.push(list_id);        countJoin  = `JOIN list_members lm ON lm.contact_id = c.id AND lm.list_id = $${countParams.length}`; }
      if (status)   { countParams.push(status);          countWhere += ` AND c.status = $${countParams.length}`; }
      if (search)   { countParams.push(`%${search}%`);  countWhere += ` AND (c.email ILIKE $${countParams.length} OR c.name ILIKE $${countParams.length})`; }

      const [{ total }] = await query(
        `SELECT COUNT(*)::int AS total FROM contacts c ${countJoin} ${countWhere}`, countParams
      );

      params.push(parseInt(limit));
      params.push((parseInt(page) - 1) * parseInt(limit));

      const rows = await query(
        `SELECT c.id, c.email, c.name, c.phone, c.company, c.status, c.source,
                c.custom_attributes, c.created_at
         FROM contacts c ${join} ${where}
         ORDER BY c.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );
      return res.status(200).json({ data: rows, total, page: parseInt(page), limit: parseInt(limit) });
    }

    // ── Sync suppression: mark contacts already in suppression list ──
    if (action === 'sync_suppression' && req.method === 'POST') {
      await query(
        `UPDATE contacts c
         SET status = CASE WHEN s.reason='unsubscribe' THEN 'unsubscribed' ELSE 'suppressed' END
         FROM suppression s
         WHERE c.email = s.email AND c.brand_id = $1 AND c.status = 'active'`,
        [brand_id]
      );
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'POST') {
      const { email, name, phone, company, source, custom_attributes } = req.body || {};
      if (!email) return res.status(400).json({ error: 'Email obrigatório' });
      const e = email.toLowerCase().trim();

      const rows = await query(
        `INSERT INTO contacts (brand_id, email, name, phone, company, source, custom_attributes)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (brand_id, email) DO UPDATE
           SET name=EXCLUDED.name, phone=EXCLUDED.phone, company=EXCLUDED.company,
               source=EXCLUDED.source, custom_attributes=EXCLUDED.custom_attributes,
               updated_at=NOW()
         RETURNING id`,
        [brand_id, e, name||null, phone||null,
         company||null, source||null, custom_attributes ? JSON.stringify(custom_attributes) : null]
      );
      // Immediately mark as suppressed/unsubscribed if in suppression list
      await query(
        `UPDATE contacts SET status = CASE WHEN s.reason='unsubscribe' THEN 'unsubscribed' ELSE 'suppressed' END
         FROM suppression s WHERE contacts.id=$1 AND contacts.email=s.email`,
        [rows[0].id]
      );
      return res.status(201).json({ id: rows[0].id, email: e });
    }

    res.status(405).json({ error: 'Método não permitido' });
  } catch (err) {
    res.status(500).json({ error: 'Erro de servidor', detail: err.message });
  }
};
