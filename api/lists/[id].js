const { query } = require('../../lib/db');
const { withAuth } = require('../../lib/auth');

module.exports = withAuth(async (req, res, user) => {
  const { id, action, contact_id, brand_id } = req.query;

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
      const { name, description } = req.body || {};
      await query('UPDATE lists SET name=COALESCE($1,name), description=$2 WHERE id=$3',
        [name||null, description||null, id]);
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

    res.status(405).json({ error: 'Método não permitido' });
  } catch (err) {
    res.status(500).json({ error: 'Erro de servidor' });
  }
});
