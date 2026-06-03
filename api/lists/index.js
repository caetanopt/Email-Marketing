const { query } = require('../../lib/db');
const { withAuth } = require('../../lib/auth');

module.exports = withAuth(async (req, res, user) => {
  const { id, brand_id, action, contact_id } = req.query;

  // Item operations when id is present (routed here via Vercel rewrite from /api/lists/:id)
  if (id) {
    const auth = await query(
      `SELECT l.* FROM lists l
       JOIN user_brand_roles ubr ON ubr.brand_id = l.brand_id AND ubr.user_id = $2
       WHERE l.id = $1`,
      [id, user.id]
    );
    if (!auth[0]) return res.status(404).json({ error: 'Lista não encontrada' });

    try {
      if (req.method === 'GET') {
        const rows = await query(
          `SELECT l.*, b.name AS brand_name,
                  COUNT(lm.contact_id)::int AS total_contacts,
                  COUNT(lm.contact_id) FILTER (WHERE c.brand_id = $2)::int AS total_contacts_in_brand
           FROM lists l
           LEFT JOIN brands b ON b.id = l.brand_id
           LEFT JOIN list_members lm ON lm.list_id = l.id
           LEFT JOIN contacts c ON c.id = lm.contact_id
           WHERE l.id = $1 GROUP BY l.id, b.name`,
          [id, brand_id || auth[0].brand_id]
        );
        return res.status(200).json(rows[0]);
      }

      if (req.method === 'PUT') {
        if (action === 'update_member_data') {
          const { contact_id: cid, extra_data } = req.body || {};
          if (!cid) return res.status(400).json({ error: 'contact_id obrigatório' });
          await query(
            'UPDATE list_members SET extra_data=$1::jsonb WHERE list_id=$2 AND contact_id=$3',
            [JSON.stringify(extra_data || {}), id, cid]
          );
          return res.status(200).json({ ok: true });
        }
        const { name, description, extra_fields } = req.body || {};
        await query(
          `UPDATE lists SET name=COALESCE($1,name), description=$2,
           extra_fields=COALESCE($3::jsonb,extra_fields) WHERE id=$4`,
          [name||null, description||null,
           extra_fields !== undefined ? JSON.stringify(extra_fields) : null, id]
        );
        return res.status(200).json({ ok: true });
      }

      if (req.method === 'DELETE') {
        if (action === 'remove_contact' && contact_id) {
          await query('DELETE FROM list_members WHERE list_id=$1 AND contact_id=$2', [id, contact_id]);
          return res.status(200).json({ ok: true });
        }
        await query('DELETE FROM lists WHERE id=$1', [id]);
        return res.status(200).json({ ok: true });
      }

      if (req.method === 'POST' && action === 'add_contact') {
        const { contact_id: cid } = req.body || {};
        if (!cid) return res.status(400).json({ error: 'contact_id obrigatório' });
        await query(
          'INSERT INTO list_members (list_id, contact_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [id, cid]
        );
        return res.status(200).json({ ok: true });
      }

      return res.status(405).json({ error: 'Método não permitido' });
    } catch (err) {
      return res.status(500).json({ error: 'Erro de servidor' });
    }
  }

  // Collection operations
  if (!brand_id) return res.status(400).json({ error: 'brand_id obrigatório' });

  try {
    if (req.method === 'GET') {
      let rows = await query(
        `SELECT l.id, l.name, l.description, l.created_at, l.extra_fields,
                COUNT(lm.contact_id)::int AS total_contacts
         FROM lists l
         JOIN user_brand_roles ubr ON ubr.brand_id = l.brand_id AND ubr.user_id = $2
         LEFT JOIN list_members lm ON lm.list_id = l.id
         WHERE l.brand_id = $1
         GROUP BY l.id ORDER BY l.name`,
        [brand_id, user.id]
      );
      // Auto-create the two default lists if brand has none
      if (rows.length === 0) {
        const defaults = [
          ['Marketing',     'Lista principal de marketing'],
          ['Colaboradores', 'Lista de colaboradores internos'],
        ];
        for (const [name, description] of defaults) {
          try {
            await query(
              'INSERT INTO lists (brand_id, name, description) VALUES ($1,$2,$3) ON CONFLICT (brand_id, name) DO NOTHING',
              [brand_id, name, description]
            );
          } catch (_) {}
        }
        rows = await query(
          `SELECT l.id, l.name, l.description, l.created_at, l.extra_fields,
                  COUNT(lm.contact_id)::int AS total_contacts
           FROM lists l
           JOIN user_brand_roles ubr ON ubr.brand_id = l.brand_id AND ubr.user_id = $2
           LEFT JOIN list_members lm ON lm.list_id = l.id
           WHERE l.brand_id = $1
           GROUP BY l.id ORDER BY l.name`,
          [brand_id, user.id]
        );
      }
      return res.status(200).json({ data: rows });
    }

    if (req.method === 'POST') {
      const { name, description } = req.body || {};
      if (!name) return res.status(400).json({ error: 'Nome obrigatório' });
      const rows = await query(
        'INSERT INTO lists (brand_id, name, description) VALUES ($1,$2,$3) RETURNING id',
        [brand_id, name, description||null]
      );
      return res.status(201).json({ id: rows[0].id, name });
    }

    res.status(405).json({ error: 'Método não permitido' });
  } catch (err) {
    res.status(500).json({ error: 'Erro de servidor' });
  }
});
