const { query } = require('../../lib/db');
const { requireAuth, cors } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  const user = requireAuth(req, res);
  if (!user) return;

  const { brand_id, status, page = 1, limit = 20 } = req.query;
  if (!brand_id) return res.status(400).json({ error: 'brand_id obrigatório' });

  try {
    if (req.method === 'GET') {
      const params = [brand_id];
      let where = 'WHERE c.brand_id=$1';
      if (status) { params.push(status); where += ` AND c.status=$${params.length}`; }
      params.push(parseInt(limit));
      params.push((parseInt(page) - 1) * parseInt(limit));

      const rows = await query(
        `SELECT c.id, c.name, c.subject, c.status, c.scheduled_at, c.sent_at, c.created_at,
                b.num AS brand_num,
                t.name AS template_name, u.name AS created_by_name,
                COUNT(DISTINCT cr.id)::int AS total_recipients,
                COUNT(DISTINCT CASE WHEN cr.status='sent' THEN cr.id END)::int AS sent_count,
                COUNT(DISTINCT CASE WHEN ee_o.type='open'  THEN ee_o.id END)::int AS open_count,
                COUNT(DISTINCT CASE WHEN ee_c.type='click' THEN ee_c.id END)::int AS click_count
         FROM campaigns c
         LEFT JOIN brands b ON b.id=c.brand_id
         LEFT JOIN templates t ON t.id=c.template_id
         LEFT JOIN users u ON u.id=c.created_by
         LEFT JOIN campaign_recipients cr ON cr.campaign_id=c.id
         LEFT JOIN email_events ee_o ON ee_o.campaign_id=c.id AND ee_o.type='open'
         LEFT JOIN email_events ee_c ON ee_c.campaign_id=c.id AND ee_c.type='click'
         ${where} GROUP BY c.id,b.num,t.name,u.name
         ORDER BY c.created_at DESC LIMIT $${params.length-1} OFFSET $${params.length}`,
        params
      );
      return res.status(200).json({ data: rows });
    }

    if (req.method === 'POST') {
      const { name, subject, preview_text, from_name, from_email,
              template_id, list_ids, scheduled_at } = req.body || {};
      if (!name) return res.status(400).json({ error: 'Nome obrigatório' });

      const rows = await query(
        `INSERT INTO campaigns (brand_id, name, subject, preview_text, from_name, from_email,
         template_id, scheduled_at, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, created_at`,
        [brand_id, name, subject||null, preview_text||null, from_name||null, from_email||null,
         template_id||null, scheduled_at||null, scheduled_at ? 'scheduled' : 'draft', user.id]
      );
      const campaignId = rows[0].id;

      if (list_ids?.length) {
        const vals = list_ids.map((_, i) => `($${i*2+1},$${i*2+2})`).join(',');
        await query(
          `INSERT INTO campaign_lists (campaign_id, list_id) VALUES ${vals}`,
          list_ids.flatMap(lid => [campaignId, lid])
        );
      }
      return res.status(201).json({ id: campaignId, name });
    }

    res.status(405).json({ error: 'Método não permitido' });
  } catch (err) {
    res.status(500).json({ error: 'Erro de servidor', detail: err.message });
  }
};
