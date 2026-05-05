const { query } = require('../../lib/db');
const { requireAuth, cors } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  const user = requireAuth(req, res);
  if (!user) return;

  const { brand_id, search, status, list_id, page = 1, limit = 50 } = req.query;
  if (!brand_id) return res.status(400).json({ error: 'brand_id obrigatório' });

  try {
    if (req.method === 'GET') {
      const params = [brand_id];
      let join = '', where = 'WHERE c.brand_id = $1';

      if (list_id) {
        params.push(list_id);
        join = `JOIN list_members lm ON lm.contact_id = c.id AND lm.list_id = $${params.length}`;
      }
      if (status)  { params.push(status);         where += ` AND c.status = $${params.length}`; }
      if (search)  { params.push(`%${search}%`);  where += ` AND (c.email ILIKE $${params.length} OR c.name ILIKE $${params.length})`; }

      params.push(parseInt(limit));
      params.push((parseInt(page) - 1) * parseInt(limit));

      const rows = await query(
        `SELECT c.id, c.email, c.name, c.phone, c.company, c.status, c.source,
                c.custom_attributes, c.created_at
         FROM contacts c ${join} ${where}
         ORDER BY c.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );
      return res.status(200).json({ data: rows, page: parseInt(page), limit: parseInt(limit) });
    }

    if (req.method === 'POST') {
      const { email, name, phone, company, source, custom_attributes } = req.body || {};
      if (!email) return res.status(400).json({ error: 'Email obrigatório' });

      const rows = await query(
        `INSERT INTO contacts (brand_id, email, name, phone, company, source, custom_attributes)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (brand_id, email) DO UPDATE
           SET name=EXCLUDED.name, phone=EXCLUDED.phone, company=EXCLUDED.company,
               source=EXCLUDED.source, custom_attributes=EXCLUDED.custom_attributes,
               updated_at=NOW()
         RETURNING id`,
        [brand_id, email.toLowerCase().trim(), name||null, phone||null,
         company||null, source||null, custom_attributes ? JSON.stringify(custom_attributes) : null]
      );
      return res.status(201).json({ id: rows[0].id, email });
    }

    res.status(405).json({ error: 'Método não permitido' });
  } catch (err) {
    res.status(500).json({ error: 'Erro de servidor', detail: err.message });
  }
};
