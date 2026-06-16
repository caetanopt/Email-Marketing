const { query } = require('../../lib/db');
const { requireAuth, cors } = require('../../lib/auth');

// Helper: confirm caller has access to the contact's brand
async function authorizeContact(userId, contactId) {
  const r = await query(
    `SELECT c.*
     FROM contacts c
     JOIN user_brand_roles ubr ON ubr.brand_id = c.brand_id AND ubr.user_id = $2
     WHERE c.id = $1`,
    [contactId, userId]
  );
  return r[0] || null;
}

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  const user = requireAuth(req, res);
  if (!user) return;

  const { id } = req.query;

  try {
    const contact = await authorizeContact(user.id, id);
    if (!contact) return res.status(404).json({ error: 'Contacto não encontrado' });

    if (req.method === 'GET') {
      const lists = await query(
        `SELECT l.id, l.name FROM lists l
         JOIN list_members lm ON lm.list_id = l.id WHERE lm.contact_id = $1`, [id]
      );
      const events = await query(
        `SELECT ee.type, ee.url, ee.created_at, c.name AS campaign_name
         FROM email_events ee JOIN campaigns c ON c.id = ee.campaign_id
         WHERE ee.contact_id = $1 ORDER BY ee.created_at DESC LIMIT 20`, [id]
      );
      return res.status(200).json({ ...contact, lists, events });
    }

    if (req.method === 'PUT') {
      const { email, name, phone, company, status, custom_attributes } = req.body || {};
      await query(
        `UPDATE contacts SET
           email=COALESCE($1,email), name=$2,
           phone=COALESCE($3,phone), company=COALESCE($4,company),
           status=COALESCE($5,status),
           custom_attributes=COALESCE($6,custom_attributes), updated_at=NOW()
         WHERE id=$7 AND brand_id=$8`,
        [email?.toLowerCase().trim()||null, name||null, phone||null, company||null,
         status||null, custom_attributes ? JSON.stringify(custom_attributes) : null, id, contact.brand_id]
      );
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      await query('DELETE FROM contacts WHERE id = $1 AND brand_id = $2', [id, contact.brand_id]);
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: 'Método não permitido' });
  } catch (err) {
    res.status(500).json({ error: 'Erro de servidor' });
  }
};
