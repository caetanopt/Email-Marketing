const { GetSendQuotaCommand } = require('@aws-sdk/client-ses');
const { query } = require('../../lib/db');
const { getSESClient } = require('../../lib/ses');
const { requireAuth, cors } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;

  // Delegate per-campaign requests (routed here via vercel.json rewrite)
  if (req.query.id) return require('./[id]')(req, res);

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

    // How long this cron invocation is allowed to run before it must stop and let
    // the next invocation continue. Default 50 s — safe margin under maxDuration:60.
    // Override with CRON_MAX_SECONDS env var (e.g. 280 on a 300 s plan).
    const DEADLINE_MS = parseInt(process.env.CRON_MAX_SECONDS || '50', 10) * 1000;
    const cronStart = Date.now();
    const timeLeft = () => DEADLINE_MS - (Date.now() - cronStart);

    // Pick up:
    //   • campaigns newly due for sending (status='scheduled')
    //   • campaigns already in 'sending' that still have work — these are mid-send
    //     from a previous cron invocation that was cut short by the function timeout.
    //     Without this second clause they would only be picked up by the stall detector
    //     (10-minute window), making large sends extremely slow.
    const due = await query(
      `SELECT id, false AS resuming FROM campaigns
       WHERE status='scheduled' AND scheduled_at <= NOW()
       UNION ALL
       SELECT c.id, true AS resuming FROM campaigns c
       WHERE c.status='sending'
         AND EXISTS (
           SELECT 1 FROM campaign_recipients cr
           WHERE cr.campaign_id=c.id AND cr.status IN ('pending','retry')
         )
       LIMIT 5`
    );

    const results = [];
    for (const { id: campId, resuming } of due) {
      // Stop processing new campaigns if we are close to the function deadline —
      // the next cron invocation will pick up the remaining work.
      if (timeLeft() < 8000) break;

      try {
        let total = 0;
        if (!resuming) {
          // initCampaignSend owns the atomic claim (UPDATE … WHERE status IN
          // ('draft','scheduled') RETURNING *). If another worker beat us here
          // it throws {code:'already_sending'} — skip and move to the next campaign.
          try {
            ({ total } = await initCampaignSend(campId));
          } catch (err) {
            if (err.code === 'already_sending') continue;
            if (err.message === 'Sem destinatários activos') {
              await query(`UPDATE campaigns SET status='sent', sent_at=NOW() WHERE id=$1`, [campId]);
              results.push({ id: campId, total: 0, sent: 0, failed: 0 });
              continue;
            }
            throw err;
          }
        }

        let totalSent = 0, totalFailed = 0;
        // Run batches until done, quota exhausted, or deadline approaching.
        let quotaExhausted = false;
        for (;;) {
          if (timeLeft() < 8000) break;
          const r = await runBatch(campId, null);
          totalSent += r.sent || 0;
          totalFailed += r.failed || 0;
          if (r.done) break;
          if (r.quotaExhausted) { quotaExhausted = true; break; }
        }
        results.push({ id: campId, resuming, total, sent: totalSent, failed: totalFailed, ...(quotaExhausted ? { quotaExhausted: true } : {}) });
      } catch (err) {
        console.error(`Cron: failed to send campaign ${campId}:`, err.message);
        results.push({ id: campId, error: err.message });
      }
    }

    // Stall safety net — catches campaigns abandoned by a browser-initiated send
    // (user closed the tab) or a server crash. With the main loop above now
    // resuming in-progress campaigns, a genuinely stalled campaign is one with
    // no activity for 3 minutes (not 10) — a shorter window means faster recovery.
    try {
      const stuck = await query(
        `SELECT c.id FROM campaigns c
         WHERE c.status='sending'
           AND EXISTS (
             SELECT 1 FROM campaign_recipients cr2
             WHERE cr2.campaign_id=c.id
               AND COALESCE(cr2.attempted_at, cr2.sent_at) IS NOT NULL
           )
           AND NOT EXISTS (
             SELECT 1 FROM campaign_recipients cr
             WHERE cr.campaign_id=c.id
               AND COALESCE(cr.attempted_at, cr.sent_at) > NOW() - INTERVAL '3 minutes'
           )
           -- exclude campaigns already queued for processing above
           AND c.id NOT IN (${due.map((_, i) => `$${i+1}`).join(',') || 'NULL'})
         LIMIT 3`,
        due.map(d => d.id)
      );
      for (const { id: campId } of stuck) {
        if (timeLeft() < 8000) break;
        try {
          let totalSent = 0, totalFailed = 0, quotaExhausted = false;
          for (;;) {
            if (timeLeft() < 8000) break;
            const r = await runBatch(campId, null);
            totalSent += r.sent || 0;
            totalFailed += r.failed || 0;
            if (r.done) break;
            if (r.quotaExhausted) { quotaExhausted = true; break; }
          }
          results.push({ id: campId, resumed: true, sent: totalSent, failed: totalFailed, ...(quotaExhausted ? { quotaExhausted: true } : {}) });
        } catch (err) {
          console.error(`Cron: failed to resume campaign ${campId}:`, err.message);
          results.push({ id: campId, resumed: true, error: err.message });
        }
      }
    } catch (err) {
      if (err.code !== '42703') console.error('Cron: stuck campaign scan failed:', err.message);
    }

    return res.status(200).json({
      ok: true, processed: results.length, elapsed_ms: Date.now() - cronStart, results
    });
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

    // Global admin = owner in ANY brand (not tied to the current brand)
    const ownerRow = await query(
      `SELECT 1 FROM user_brand_roles WHERE user_id=$1 AND role='owner' LIMIT 1`,
      [user.id]
    );
    const isGroupAdmin = !!ownerRow[0];

    // Pre-aggregate per table to avoid the cartesian explosion of joining
    // campaign_recipients AND email_events on the same campaign row.
    const statsBody = (brandFilterJoin) => `
      WITH sc AS (
        SELECT c.id, c.brand_id FROM campaigns c
        WHERE c.status='sent' ${sinceClause}
      ),
      cc AS (SELECT brand_id, COUNT(*)::int AS campaigns FROM sc GROUP BY brand_id),
      rc AS (
        SELECT sc.brand_id,
               COUNT(*) FILTER (WHERE cr.status='sent')::int    AS sent,
               COUNT(*) FILTER (WHERE cr.status='bounced')::int AS bounced
        FROM campaign_recipients cr JOIN sc ON sc.id=cr.campaign_id
        GROUP BY sc.brand_id
      ),
      ev AS (
        SELECT sc.brand_id,
               COUNT(DISTINCT ee.contact_id) FILTER (WHERE ee.type='open')::int        AS unique_opens,
               COUNT(DISTINCT ee.contact_id) FILTER (WHERE ee.type='click')::int       AS unique_clicks,
               COUNT(DISTINCT ee.contact_id) FILTER (WHERE ee.type='unsubscribe')::int AS unsubscribes
        FROM email_events ee JOIN sc ON sc.id=ee.campaign_id
        GROUP BY sc.brand_id
      )
      SELECT b.id, b.name, b.color, b.logo_url,
             COALESCE(cc.campaigns,0)     AS campaigns,
             COALESCE(rc.sent,0)          AS sent,
             COALESCE(rc.bounced,0)       AS bounced,
             COALESCE(ev.unique_opens,0)  AS unique_opens,
             COALESCE(ev.unique_clicks,0) AS unique_clicks,
             COALESCE(ev.unsubscribes,0)  AS unsubscribes
      FROM brands b
      ${brandFilterJoin}
      LEFT JOIN cc ON cc.brand_id=b.id
      LEFT JOIN rc ON rc.brand_id=b.id
      LEFT JOIN ev ON ev.brand_id=b.id
      WHERE b.active=TRUE
      ORDER BY COALESCE(rc.sent,0) DESC`;

    let perBrand;
    if (isGroupAdmin) {
      // Admin: all active brands (no role restriction)
      perBrand = await query(statsBody(''), days ? [days] : []);
    } else {
      // Non-admin: only brands the user has a role in
      const params = days ? [days] : [];
      perBrand = await query(
        statsBody(`JOIN user_brand_roles ubr ON ubr.brand_id=b.id AND ubr.user_id=$${params.length+1}`),
        days ? [days, user.id] : [user.id]
      );
    }

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
      // Per-campaign counters via LATERAL sub-queries — joining recipients AND
      // events on the same row multiplies them (cartesian) and is very slow.
      const campaignCounters = `
        LEFT JOIN LATERAL (
          SELECT COUNT(*) FILTER (WHERE cr.status='sent')::int AS sent
          FROM campaign_recipients cr WHERE cr.campaign_id=c.id
        ) rc ON TRUE
        LEFT JOIN LATERAL (
          SELECT COUNT(DISTINCT ee.contact_id) FILTER (WHERE ee.type='open' )::int AS unique_opens,
                 COUNT(DISTINCT ee.contact_id) FILTER (WHERE ee.type='click')::int AS unique_clicks
          FROM email_events ee WHERE ee.campaign_id=c.id
        ) ev ON TRUE`;
      const [[agg], recent, top] = await Promise.all([
        query(
          `WITH sc AS (
             SELECT id FROM campaigns
             WHERE brand_id=$1 AND status='sent' AND sent_at >= NOW() - ($2 * INTERVAL '1 day')
           ),
           rc AS (
             SELECT COUNT(*)::int AS total_recipients,
                    COUNT(*) FILTER (WHERE status='sent')::int    AS sent,
                    COUNT(*) FILTER (WHERE status='bounced')::int AS bounced
             FROM campaign_recipients WHERE campaign_id IN (SELECT id FROM sc)
           ),
           ev AS (
             SELECT COUNT(DISTINCT contact_id) FILTER (WHERE type='open' )::int AS unique_opens,
                    COUNT(DISTINCT contact_id) FILTER (WHERE type='click')::int AS unique_clicks
             FROM email_events WHERE campaign_id IN (SELECT id FROM sc)
           )
           SELECT (SELECT COUNT(*)::int FROM sc) AS campaigns,
                  rc.sent, rc.bounced, rc.total_recipients,
                  ev.unique_opens, ev.unique_clicks
           FROM rc, ev`,
          sinceParams
        ),
        query(
          `SELECT c.id, c.name, c.subject, c.sent_at, c.status,
                  COALESCE(rc.sent,0) AS sent,
                  COALESCE(ev.unique_opens,0)  AS unique_opens,
                  COALESCE(ev.unique_clicks,0) AS unique_clicks
           FROM campaigns c
           ${campaignCounters}
           WHERE c.brand_id=$1 AND c.status='sent' AND c.sent_at >= NOW() - ($2 * INTERVAL '1 day')
           ORDER BY c.sent_at DESC NULLS LAST LIMIT 5`,
          sinceParams
        ),
        query(
          `WITH base AS (
             SELECT c.id, c.name, c.subject, c.sent_at, c.status,
                    COALESCE(rc.sent,0) AS sent,
                    COALESCE(ev.unique_opens,0)  AS unique_opens,
                    COALESCE(ev.unique_clicks,0) AS unique_clicks
             FROM campaigns c
             ${campaignCounters}
             WHERE c.brand_id=$1 AND c.status='sent' AND c.sent_at >= NOW() - ($2 * INTERVAL '1 day')
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
                COALESCE(rc.total,0) AS total_recipients,
                COALESCE(rc.sent,0)  AS sent_count,
                COALESCE(ev.opens,0)  AS open_count,
                COALESCE(ev.clicks,0) AS click_count
         FROM campaigns c
         LEFT JOIN brands b ON b.id=c.brand_id
         LEFT JOIN templates t ON t.id=c.template_id
         LEFT JOIN users u ON u.id=c.created_by
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int AS total,
                  COUNT(*) FILTER (WHERE cr.status='sent')::int AS sent
           FROM campaign_recipients cr WHERE cr.campaign_id=c.id
         ) rc ON TRUE
         LEFT JOIN LATERAL (
           SELECT COUNT(*) FILTER (WHERE ee.type='open' )::int AS opens,
                  COUNT(*) FILTER (WHERE ee.type='click')::int AS clicks
           FROM email_events ee WHERE ee.campaign_id=c.id
         ) ev ON TRUE
         ${where}
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
        const accessible = await query(
          `SELECT l.id FROM lists l
           JOIN user_brand_roles ubr ON ubr.brand_id = l.brand_id AND ubr.user_id = $2
           WHERE l.id = ANY($1::int[])`,
          [list_ids, user.id]
        );
        if (accessible.length !== list_ids.length) return res.status(400).json({ error: 'Uma ou mais listas não são acessíveis' });
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
    console.error('campaigns handler error:', err?.message, err?.code);
    res.status(500).json({ error: err?.message || 'Erro de servidor' });
  }
};
