const { query } = require('../../lib/db');
const { requireAuth, cors } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  const user = requireAuth(req, res);
  if (!user) return;

  const { id, action, contact_id } = req.query;

  try {
    if (req.method === 'GET') {
      const rows = await query(
        `SELECT l.*, COUNT(lm.contact_id)::int AS total_contacts
         FROM lists l LEFT JOIN list_members lm ON lm.list_id = l.id
         WHERE l.id = $1 GROUP BY l.id`, [id]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Lista não encontrada' });
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
    res.status(500).json({ error: 'Erro de servidor', detail: err.message });
  }
};
