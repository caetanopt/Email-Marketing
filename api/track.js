/**
 * /api/track
 *
 * GET ?type=open&cid=<campaignId>&uid=<contactId>&t=<token>
 *   → Returns a 1×1 transparent GIF and records the open in email_events.
 *
 * GET ?type=click&cid=<campaignId>&uid=<contactId>&t=<token>&url=<destination>
 *   → Redirects to destination URL and records the click in email_events.
 *
 * POST (also routed from /api/webhooks via vercel.json rewrite)
 *   → Handles AWS SES notifications via SNS (bounce, complaint, open, click).
 */
const { query } = require('../lib/db');
const crypto = require('crypto');

// 1×1 transparent GIF (base64)
const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

function trackToken(campaignId, contactId) {
  return crypto.createHmac('sha256', process.env.JWT_SECRET)
    .update(`track:${campaignId}:${contactId}`)
    .digest('hex').slice(0, 16);
}

function rawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  // ── POST: AWS SNS / SES webhook ────────────────────────────────
  if (req.method === 'POST') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-amz-sns-message-type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
      const msgType = req.headers['x-amz-sns-message-type'] || '';

      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { return res.status(400).end(); }
      }
      if (!body) {
        const raw = await rawBody(req);
        try { body = JSON.parse(raw); } catch { return res.status(400).end(); }
      }

      // SNS subscription confirmation — auto-confirm
      if (msgType === 'SubscriptionConfirmation' || body.Type === 'SubscriptionConfirmation') {
        const url = body.SubscribeURL;
        if (url && url.startsWith('https://sns.')) {
          await fetch(url);
        }
        return res.status(200).json({ ok: true, confirmed: true });
      }

      // SNS notification wrapping SES event
      let sesEvent = body;
      if (body.Type === 'Notification' && body.Message) {
        try { sesEvent = JSON.parse(body.Message); } catch { return res.status(400).end(); }
      }

      const eventType = (sesEvent.eventType || sesEvent.notificationType || '').toLowerCase();

      if (eventType === 'bounce') {
        const bounce = sesEvent.bounce || {};
        const recipients = bounce.bouncedRecipients || [];
        const isPermanent = bounce.bounceType === 'Permanent';
        const isTransient = bounce.bounceType === 'Transient';

        for (const r of recipients) {
          const email = r.emailAddress?.toLowerCase();
          if (!email) continue;

          if (isPermanent) {
            const rows = await query(
              `UPDATE campaign_recipients SET status='bounced', error_message=$2
               WHERE email=$1 AND status IN ('sent','retry') RETURNING campaign_id, contact_id`,
              [email, r.diagnosticCode || 'Hard bounce']
            );
            for (const row of rows) {
              await query(
                `INSERT INTO email_events (campaign_id, contact_id, type, created_at) VALUES ($1,$2,'bounce',NOW())`,
                [row.campaign_id, row.contact_id]
              );
            }
            await query(
              "INSERT INTO suppression (email, reason) VALUES ($1,'bounce') ON CONFLICT (email) DO NOTHING",
              [email]
            );
            await query("UPDATE contacts SET status='suppressed' WHERE email=$1", [email]);

          } else if (isTransient) {
            const rows = await query(
              `UPDATE campaign_recipients
               SET retry_count = COALESCE(retry_count, 0) + 1,
                   error_message = $2,
                   status = CASE WHEN COALESCE(retry_count, 0) >= 2 THEN 'failed' ELSE 'retry' END
               WHERE email=$1 AND status IN ('sent','retry')
               RETURNING campaign_id, contact_id, status, retry_count`,
              [email, r.diagnosticCode || 'Soft bounce']
            );
            for (const row of rows) {
              await query(
                `INSERT INTO email_events (campaign_id, contact_id, type, created_at) VALUES ($1,$2,'bounce',NOW())`,
                [row.campaign_id, row.contact_id]
              );
            }
          } else {
            const rows = await query(
              `UPDATE campaign_recipients SET status='bounced', error_message=$2
               WHERE email=$1 AND status IN ('sent','retry') RETURNING campaign_id, contact_id`,
              [email, r.diagnosticCode || 'Bounce']
            );
            for (const row of rows) {
              await query(
                `INSERT INTO email_events (campaign_id, contact_id, type, created_at) VALUES ($1,$2,'bounce',NOW())`,
                [row.campaign_id, row.contact_id]
              );
            }
          }
        }

      } else if (eventType === 'complaint') {
        const complaint = sesEvent.complaint || {};
        const recipients = complaint.complainedRecipients || [];
        for (const r of recipients) {
          const email = r.emailAddress?.toLowerCase();
          if (!email) continue;
          const rows = await query(
            `UPDATE campaign_recipients SET status='failed' WHERE email=$1 AND status='sent' RETURNING campaign_id, contact_id`,
            [email]
          );
          for (const row of rows) {
            await query(
              `INSERT INTO email_events (campaign_id, contact_id, type, created_at) VALUES ($1,$2,'spam',NOW()) ON CONFLICT DO NOTHING`,
              [row.campaign_id, row.contact_id]
            );
          }
          await query(
            "INSERT INTO suppression (email, reason) VALUES ($1,'spam') ON CONFLICT (email) DO NOTHING",
            [email]
          );
          await query("UPDATE contacts SET status='suppressed' WHERE email=$1", [email]);
        }

      } else if (eventType === 'open') {
        const mail = sesEvent.mail || {};
        const campaignId = mail.headers?.find(h => h.name === 'X-Campaign-Id')?.value;
        const contactId  = mail.headers?.find(h => h.name === 'X-Contact-Id')?.value;
        if (campaignId && contactId) {
          await query(
            `INSERT INTO email_events (campaign_id, contact_id, type, created_at) VALUES ($1,$2,'open',NOW())`,
            [campaignId, contactId]
          );
        }

      } else if (eventType === 'click') {
        const mail = sesEvent.mail || {};
        const click = sesEvent.click || {};
        const campaignId = mail.headers?.find(h => h.name === 'X-Campaign-Id')?.value;
        const contactId  = mail.headers?.find(h => h.name === 'X-Contact-Id')?.value;
        if (campaignId && contactId) {
          await query(
            `INSERT INTO email_events (campaign_id, contact_id, type, url, created_at) VALUES ($1,$2,'click',$3,NOW())`,
            [campaignId, contactId, click.link || null]
          );
        }
      }

      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('Webhook error:', err?.message);
      return res.status(500).json({ error: 'Erro interno' });
    }
  }

  // ── GET: pixel/click tracking ──────────────────────────────────
  const { type, cid, uid, t, url } = req.query;

  if (type === 'click') {
    const dest = url && url.startsWith('http') ? url : '/';
    res.setHeader('Location', dest);
    res.setHeader('Cache-Control', 'no-store');
    res.status(302).end();

    try {
      if (!cid || !uid || !t) return;
      const expected = trackToken(cid, uid);
      if (t !== expected) return;

      const campaignId = parseInt(cid, 10);
      const contactId  = parseInt(uid, 10);
      if (isNaN(campaignId) || isNaN(contactId)) return;

      await query(
        `INSERT INTO email_events (campaign_id, contact_id, type, url, created_at)
         VALUES ($1, $2, 'click', $3, NOW())`,
        [campaignId, contactId, url || null]
      );
    } catch (e) {
      console.error('track click error:', e.message);
    }
    return;
  }

  // Default: open pixel
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.status(200).end(PIXEL);

  try {
    if (!cid || !uid || !t) return;
    const expected = trackToken(cid, uid);
    if (t !== expected) return;

    const campaignId = parseInt(cid, 10);
    const contactId  = parseInt(uid, 10);
    if (isNaN(campaignId) || isNaN(contactId)) return;

    await query(
      `INSERT INTO email_events (campaign_id, contact_id, type, created_at)
       VALUES ($1, $2, 'open', NOW())`,
      [campaignId, contactId]
    );
  } catch (e) {
    console.error('track open error:', e.message);
  }
};
