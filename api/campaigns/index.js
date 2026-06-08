const { GetSendQuotaCommand } = require('@aws-sdk/client-ses');
const { query } = require('../../lib/db');
const { getSESClient } = require('../../lib/ses');
const { requireAuth, cors } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;

  const { brand_id, status, page = 1, limit = 20, action, range } = req.query;

  // ── Cron: process scheduled campaigns ──────────────────
  if (action === 'process-scheduled') {
    const authHeader = req.headers['authorization'] || '';
    const cronSecret = process.env.CRON_SECRET || '';
    const isVercelCron = req.headers['x-vercel-cron'] === '1';
    if (!isVercelCron && (!cronSecret || authHeader !== `Bearer ${cronSecret}`)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { initCampaignSend, runBatch } = require('../../lib/sendCampaign');

    // Find campaigns due for sending
    const due = await query(
      `SELECT id FROM campaigns WHERE status='scheduled' AND scheduled_at <= NOW() LIMIT 5`
    );

    const results = [];
    for (const { id: campId } of due) {
      try {
        const { total } = await initCampaignSend(campId);
        let totalSent = 0, totalFailed = 0;
        for (let b = 0; b < 20; b++) {
          const r = await runBatch(campId, null);
          totalSent += r.sent || 0;
          totalFailed += r.failed || 0;
          if (r.done) break;
        }
        results.push({ id: campId, total, sent: totalSent, failed: totalFailed });
      } catch (err) {
        console.error(`Cron: failed to send campaign ${campId}:`, err.message);
        results.push({ id: campId, error: err.message });
      }
    }

    return res.status(200).json({ ok: true, processed: results.length, results });
  }

  const user = requireAuth(req, res);
  if (!user) return;

  // SES quota — does not require brand_id
  if (action === 'ses-quota' && req.method === 'GET') {
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) return res.status(200).json({ configured: false });
    try {
      const { Max24HourSend, SentLast24Hours, MaxSendRate } = await getSESClient().send(new GetSendQuotaCommand({}));
      return res.status(200).json({
        configured: true,
        max24h: Math.floor(Max24HourSend),
        sent24h: Math.floor(SentLast24Hours),
        remaining: Math.floor(Max24HourSend - SentLast24Hours),
        maxRate: MaxSendRate,
      });
    } catch (err) {
      return res.status(200).json({ configured: true, error: err.message });
    }
  }

  // Global stats across all brands the user has access to
  if (action === 'global_stats' && req.method === 'GET') {
    const days = ({ '7d': 7, '30d': 30, '90d': 90, '12m': 365 })[range || 'all'] || null;
    const sinceClause = days ? `AND c.sent_at >= NOW() - ($1 * INTERVAL '1 day')` : '';
    const params = days ? [days] : [];

    const perBrand = await query(
      `SELECT
          b.id, b.name, b.color, b.logo_url,
          COUNT(DISTINCT c.id) FILTER (WHERE c.status='sent')::int            AS campaigns,
          COUNT(DISTINCT cr.id) FILTER (WHERE cr.status='sent')::int           AS sent,
          COUNT(DISTINCT cr.id) FILTER (WHERE cr.status='bounced')::int        AS bounced,
          COUNT(DISTINCT ee.contact_id) FILTER (WHERE ee.type='open')::int     AS unique_opens,
          COUNT(DISTINCT ee.contact_id) FILTER (WHERE ee.type='click')::int    AS unique_clicks,
          COUNT(DISTINCT ee.contact_id) FILTER (WHERE ee.type='unsubscribe')::int AS unsubscribes
       FROM brands b
       JOIN user_brand_roles ubr ON ubr.brand_id=b.id AND ubr.user_id=$${params.length+1}
       LEFT JOIN campaigns c ON c.brand_id=b.id AND c.status='sent' ${sinceClause}
       LEFT JOIN campaign_recipients cr ON cr.campaign_id=c.id
       LEFT JOIN email_events ee ON ee.campaign_id=c.id
       WHERE b.active=TRUE
       GROUP BY b.id ORDER BY sent DESC`,
      days ? [days, user.id] : [user.id]
    );

    const totals = perBrand.reduce((acc, b) => ({
      campaigns:   acc.campaigns   + b.campaigns,
      sent:        acc.sent        + b.sent,
      bounced:     acc.bounced     + b.bounced,
      unique_opens:  acc.unique_opens  + b.unique_opens,
      unique_clicks: acc.unique_clicks + b.unique_clicks,
      unsubscribes:  acc.unsubscribes  + b.unsubscribes,
    }), { campaigns:0, sent:0, bounced:0, unique_opens:0, unique_clicks:0, unsubscribes:0 });

    const rate = (n, d) => d ? +((n/d)*100).toFixed(1) : 0;
    return res.status(200).json({
      totals: {
        ...totals,
        openRate:    rate(totals.unique_opens,  totals.sent),
        clickRate:   rate(totals.unique_clicks, totals.sent),
        bounceRate:  rate(totals.bounced,       totals.sent),
        unsubRate:   rate(totals.unsubscribes,  totals.sent),
      },
      brands: perBrand.map(b => ({
        ...b,
        openRate:   rate(b.unique_opens,  b.sent),
        clickRate:  rate(b.unique_clicks, b.sent),
        bounceRate: rate(b.bounced,       b.sent),
        unsubRate:  rate(b.unsubscribes,  b.sent),
      })),
    });
  }

  if (!brand_id) return res.status(400).json({ error: 'brand_id obrigatório' });

  try {
    if (action === 'dashboard' && req.method === 'GET') {
      const days = ({ '7d': 7, '30d': 30, '90d': 90, '12m': 365 })[range || '30d'] || 30;
      const sinceParams = [brand_id, days];
      const [[agg], recent, top] = await Promise.all([
        query(
          `SELECT
              COUNT(DISTINCT c.id)::int AS campaigns,
              COUNT(DISTINCT cr.id) FILTER (WHERE cr.status='sent')::int  AS sent,
              COUNT(DISTINCT cr.id) FILTER (WHERE cr.status='bounced')::int AS bounced,
              COUNT(DISTINCT cr.id)::int AS total_recipients,
              COUNT(DISTINCT ee.contact_id) FILTER (WHERE ee.type='open' )::int AS unique_opens,
              COUNT(DISTINCT ee.contact_id) FILTER (WHERE ee.type='click')::int AS unique_clicks
           FROM campaigns c
           LEFT JOIN campaign_recipients cr ON cr.campaign_id=c.id
           LEFT JOIN email_events ee ON ee.campaign_id=c.id
           WHERE c.brand_id=$1 AND c.status='sent' AND c.sent_at >= NOW() - ($2 * INTERVAL '1 day')`,
          sinceParams
        ),
        query(
          `SELECT c.id, c.name, c.subject, c.sent_at, c.status,
                  COUNT(DISTINCT cr.id) FILTER (WHERE cr.status='sent')::int AS sent,
                  COUNT(DISTINCT ee.contact_id) FILTER (WHERE ee.type='open' )::int AS unique_opens,
                  COUNT(DISTINCT ee.contact_id) FILTER (WHERE ee.type='click')::int AS unique_clicks
           FROM campaigns c
           LEFT JOIN campaign_recipients cr ON cr.campaign_id=c.id
           LEFT JOIN email_events ee ON ee.campaign_id=c.id
           WHERE c.brand_id=$1 AND c.status='sent' AND c.sent_at >= NOW() - ($2 * INTERVAL '1 day')
           GROUP BY c.id ORDER BY c.sent_at DESC NULLS LAST LIMIT 5`,
          sinceParams
        ),
        query(
          `WITH base AS (
             SELECT c.id, c.name, c.subject, c.sent_at, c.status,
                    COUNT(DISTINCT cr.id) FILTER (WHERE cr.status='sent')::int AS sent,
                    COUNT(DISTINCT ee.contact_id) FILTER (WHERE ee.type='open' )::int AS unique_opens,
                    COUNT(DISTINCT ee.contact_id) FILTER (WHERE ee.type='click')::int AS unique_clicks
             FROM campaigns c
             LEFT JOIN campaign_recipients cr ON cr.campaign_id=c.id
             LEFT JOIN email_events ee ON ee.campaign_id=c.id
             WHERE c.brand_id=$1 AND c.status='sent' AND c.sent_at >= NOW() - ($2 * INTERVAL '1 day')
             GROUP BY c.id
           )
           SELECT * FROM base
           WHERE sent > 0
           ORDER BY unique_opens::float / NULLIF(sent, 0) DESC NULLS LAST
           LIMIT 5`,
          sinceParams
        ),
      ]);
      const sent = agg?.sent || 0;
      const openRate   = sent ? +((agg.unique_opens  / sent) * 100).toFixed(1) : 0;
      const clickRate  = sent ? +((agg.unique_clicks / sent) * 100).toFixed(1) : 0;
      const bounceRate = (agg.total_recipients) ? +((agg.bounced / agg.total_recipients) * 100).toFixed(1) : 0;
      return res.status(200).json({
        campaigns: agg?.campaigns || 0,
        emails:    sent,
        openRate,
        clickRate,
        bounceRate,
        recent,
        top,
      });
    }

    if (req.method === 'GET') {
      const params = [brand_id];
      let where = 'WHERE c.brand_id=$1';
      if (status) { params.push(status); where += ` AND c.status=$${params.length}`; }
      params.push(parseInt(limit));
      params.push((parseInt(page) - 1) * parseInt(limit));

      const rows = await query(
        `SELECT c.id, c.name, c.subject, c.status, c.scheduled_at, c.sent_at, c.created_at,
                c.from_name, c.from_email, c.preview_text, c.utm_params,
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
              template_id, list_ids, scheduled_at, utm_params } = req.body || {};
      if (!name) return res.status(400).json({ error: 'Nome obrigatório' });

      const brandAccess = await query(
        'SELECT 1 FROM user_brand_roles WHERE user_id=$1 AND brand_id=$2',
        [user.id, brand_id]
      );
      if (!brandAccess[0]) return res.status(403).json({ error: 'Acesso negado a esta marca' });

      const utmJson = utm_params && typeof utm_params === 'object' && Object.values(utm_params).some(Boolean)
        ? JSON.stringify(utm_params) : null;

      if (template_id) {
        const tpl = await query('SELECT 1 FROM templates WHERE id=$1 AND brand_id=$2', [template_id, brand_id]);
        if (!tpl[0]) return res.status(400).json({ error: 'Template não pertence a esta marca' });
      }
      if (list_ids?.length) {
        const owned = await query(
          `SELECT id FROM lists WHERE id = ANY($1::int[]) AND brand_id = $2`,
          [list_ids, brand_id]
        );
        if (owned.length !== list_ids.length) return res.status(400).json({ error: 'Uma ou mais listas não pertencem a esta marca' });
      }

      const rows = await query(
        `INSERT INTO campaigns (brand_id, name, subject, preview_text, from_name, from_email,
         template_id, scheduled_at, status, created_by, utm_params)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, created_at`,
        [brand_id, name, subject||null, preview_text||null, from_name||null, from_email||null,
         template_id||null, scheduled_at||null, scheduled_at ? 'scheduled' : 'draft', user.id, utmJson]
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
    res.status(500).json({ error: 'Erro de servidor' });
  }
};
