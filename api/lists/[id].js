const { getPool } = require('../../lib/db');
const { requireAuth, cors } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  const user = requireAuth(req, res);
  if (!user) return;

  const { id, action, contact_id } = req.query;
  const db = getPool();

  if (req.method === 'GET') {
    const [[list]] = await db.query(
      `SELECT l.*, COUNT(lm.contact_id) AS total_contacts
       FROM lists l LEFT JOIN list_members lm ON lm.list_id = l.id
       WHERE l.id = ? GROUP BY l.id`, [id]
    );
    if (!list) return res.status(404).json({ error: 'Lista não encontrada' });
    return res.status(200).json(list);
  }

  if (req.method === 'PUT') {
    const { name, description } = req.body || {};
    await db.query('UPDATE lists SET name=COALESCE(?,name), description=? WHERE id=?',
      [name || null, description || null, id]);
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    if (action === 'remove_contact' && contact_id) {
      await db.query('DELETE FROM list_members WHERE list_id=? AND contact_id=?', [id, contact_id]);
      return res.status(200).json({ ok: true });
    }
    await db.query('DELETE FROM lists WHERE id=?', [id]);
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'POST' && action === 'add_contact') {
    const { contact_id: cid } = req.body || {};
    if (!cid) return res.status(400).json({ error: 'contact_id obrigatório' });
    await db.query('INSERT IGNORE INTO list_members (list_id, contact_id) VALUES (?,?)', [id, cid]);
    return res.status(200).json({ ok: true });
  }

  res.status(405).json({ error: 'Método não permitido' });
};
