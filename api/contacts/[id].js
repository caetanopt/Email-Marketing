const { getPool } = require('../../lib/db');
const { requireAuth, cors } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  const user = requireAuth(req, res);
  if (!user) return;

  const { id } = req.query;
  const db = getPool();

  if (req.method === 'GET') {
    const [[contact]] = await db.query('SELECT * FROM contacts WHERE id = ?', [id]);
    if (!contact) return res.status(404).json({ error: 'Contacto não encontrado' });

    const [lists] = await db.query(
      `SELECT l.id, l.name FROM lists l
       JOIN list_members lm ON lm.list_id = l.id
       WHERE lm.contact_id = ?`, [id]
    );
    const [events] = await db.query(
      `SELECT ee.type, ee.url, ee.created_at, c.name AS campaign_name
       FROM email_events ee
       JOIN campaigns c ON c.id = ee.campaign_id
       WHERE ee.contact_id = ?
       ORDER BY ee.created_at DESC LIMIT 20`, [id]
    );

    return res.status(200).json({ ...contact, lists, events });
  }

  if (req.method === 'PUT') {
    const { email, name, phone, company, status, custom_attributes } = req.body || {};
    await db.query(
      `UPDATE contacts SET email=COALESCE(?,email), name=?, phone=?, company=?,
       status=COALESCE(?,status), custom_attributes=COALESCE(?,custom_attributes)
       WHERE id = ?`,
      [email?.toLowerCase().trim() || null, name || null, phone || null,
       company || null, status || null,
       custom_attributes ? JSON.stringify(custom_attributes) : null, id]
    );
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    await db.query('DELETE FROM contacts WHERE id = ?', [id]);
    return res.status(200).json({ ok: true });
  }

  res.status(405).json({ error: 'Método não permitido' });
};
