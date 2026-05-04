const { getPool } = require('../../lib/db');
const { requireAuth, cors } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  const user = requireAuth(req, res);
  if (!user) return;

  const { brand_id, search, status, list_id, page = 1, limit = 50 } = req.query;
  if (!brand_id) return res.status(400).json({ error: 'brand_id obrigatório' });

  const db = getPool();

  if (req.method === 'GET') {
    let sql = `SELECT c.id, c.email, c.name, c.phone, c.company, c.status, c.source,
                      c.custom_attributes, c.created_at
               FROM contacts c`;
    const params = [];

    if (list_id) {
      sql += ' JOIN list_members lm ON lm.contact_id = c.id AND lm.list_id = ?';
      params.push(list_id);
    }

    sql += ' WHERE c.brand_id = ?';
    params.push(brand_id);

    if (status) { sql += ' AND c.status = ?'; params.push(status); }
    if (search) {
      sql += ' AND (c.email LIKE ? OR c.name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    sql += ' ORDER BY c.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

    const [rows] = await db.query(sql, params);

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM contacts c ${list_id ? 'JOIN list_members lm ON lm.contact_id = c.id AND lm.list_id = ?' : ''}
       WHERE c.brand_id = ? ${status ? 'AND c.status = ?' : ''} ${search ? 'AND (c.email LIKE ? OR c.name LIKE ?)' : ''}`,
      list_id
        ? [list_id, brand_id, ...(status ? [status] : []), ...(search ? [`%${search}%`, `%${search}%`] : [])]
        : [brand_id, ...(status ? [status] : []), ...(search ? [`%${search}%`, `%${search}%`] : [])]
    );

    return res.status(200).json({ data: rows, total, page: parseInt(page), limit: parseInt(limit) });
  }

  if (req.method === 'POST') {
    const { email, name, phone, company, source, custom_attributes } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Email obrigatório' });

    const [result] = await db.query(
      `INSERT INTO contacts (brand_id, email, name, phone, company, source, custom_attributes)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name=VALUES(name), phone=VALUES(phone), company=VALUES(company),
         source=VALUES(source), custom_attributes=VALUES(custom_attributes)`,
      [brand_id, email.toLowerCase().trim(), name || null, phone || null,
       company || null, source || null, custom_attributes ? JSON.stringify(custom_attributes) : null]
    );

    return res.status(201).json({ id: result.insertId, email });
  }

  res.status(405).json({ error: 'Método não permitido' });
};
