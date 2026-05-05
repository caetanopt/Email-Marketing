const { query } = require('../../lib/db');
const { requireAuth, cors } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  const user = requireAuth(req, res);
  if (!user) return;

  const { id } = req.query;

  try {
    if (req.method === 'GET') {
      const rows = await query('SELECT * FROM contacts WHERE id = $1', [id]);
      if (!rows[0]) return res.status(404).json({ error: 'Contacto não encontrado' });

      const lists = await query(
        `SELECT l.id, l.name FROM lists l
         JOIN list_members lm ON lm.list_id = l.id WHERE lm.contact_id = $1`, [id]
      );
      const events = await query(
        `SELECT ee.type, ee.url, ee.created_at, c.name AS campaign_name
         FROM email_events ee JOIN campaigns c ON c.id = ee.campaign_id
         WHERE ee.contact_id = $1 ORDER BY ee.created_at DESC LIMIT 20`, [id]
      );
      return res.status(200).json({ ...rows[0], lists, events });
    }

    if (req.method === 'PUT') {
      const { email, name, phone, company, status, custom_attributes } = req.body || {};
      await query(
        `UPDATE contacts SET
           email=COALESCE($1,email), name=$2, phone=$3, company=$4,
           status=COALESCE($5,status),
           custom_attributes=COALESCE($6,custom_attributes), updated_at=NOW()
         WHERE id=$7`,
        [email?.toLowerCase().trim()||null, name||null, phone||null, company||null,
         status||null, custom_attributes ? JSON.stringify(custom_attributes) : null, id]
      );
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      await query('DELETE FROM contacts WHERE id = $1', [id]);
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: 'Método não permitido' });
  } catch (err) {
    res.status(500).json({ error: 'Erro de servidor', detail: err.message });
  }
};
