const { getPool } = require('../../lib/db');
const { requireAuth, cors } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  const user = requireAuth(req, res);
  if (!user) return;

  const { brand_id, status, page = 1, limit = 20 } = req.query;
  if (!brand_id) return res.status(400).json({ error: 'brand_id obrigatório' });

  const db = getPool();

  if (req.method === 'GET') {
    let sql = `SELECT c.id, c.name, c.subject, c.status, c.scheduled_at, c.sent_at, c.created_at,
                      t.name AS template_name,
                      u.name AS created_by_name,
                      COUNT(DISTINCT cr.id) AS total_recipients,
                      SUM(cr.status='sent') AS sent_count,
                      SUM(ee_open.id IS NOT NULL) AS open_count,
                      SUM(ee_click.id IS NOT NULL) AS click_count
               FROM campaigns c
               LEFT JOIN templates t ON t.id = c.template_id
               LEFT JOIN users u ON u.id = c.created_by
               LEFT JOIN campaign_recipients cr ON cr.campaign_id = c.id
               LEFT JOIN email_events ee_open  ON ee_open.campaign_id  = c.id AND ee_open.type  = 'open'
               LEFT JOIN email_events ee_click ON ee_click.campaign_id = c.id AND ee_click.type = 'click'
               WHERE c.brand_id = ?`;
    const params = [brand_id];

    if (status) { sql += ' AND c.status = ?'; params.push(status); }
    sql += ' GROUP BY c.id ORDER BY c.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

    const [rows] = await db.query(sql, params);
    return res.status(200).json({ data: rows });
  }

  if (req.method === 'POST') {
    const { name, subject, preview_text, from_name, from_email,
            template_id, list_ids, scheduled_at } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Nome obrigatório' });

    const [result] = await db.query(
      `INSERT INTO campaigns (brand_id, name, subject, preview_text, from_name, from_email,
       template_id, scheduled_at, status, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [brand_id, name, subject || null, preview_text || null, from_name || null,
       from_email || null, template_id || null,
       scheduled_at || null, scheduled_at ? 'scheduled' : 'draft', user.id]
    );

    const campaignId = result.insertId;
    if (list_ids?.length) {
      await db.query(
        'INSERT INTO campaign_lists (campaign_id, list_id) VALUES ' + list_ids.map(() => '(?,?)').join(','),
        list_ids.flatMap(lid => [campaignId, lid])
      );
    }

    return res.status(201).json({ id: campaignId, name });
  }

  res.status(405).json({ error: 'Método não permitido' });
};
