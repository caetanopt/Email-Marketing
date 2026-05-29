const { query, transaction } = require('../lib/db');
const crypto = require('crypto');

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

      if (msgType === 'SubscriptionConfirmation' || body.Type === 'SubscriptionConfirmation') {
        try {
          const parsed = new URL(body.SubscribeURL || '');
          if (parsed.protocol === 'https:' && parsed.hostname.endsWith('.amazonaws.com')) {
            await fetch(parsed.href);
          }
        } catch {}
        return res.status(200).json({ ok: true, confirmed: true });
      }

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

        await transaction(async (q) => {
          const eventRows = [];

          for (const r of recipients) {
            const email = r.emailAddress?.toLowerCase();
            if (!email) continue;

            if (isTransient) {
              const rows = await q(
                `UPDATE campaign_recipients
                 SET retry_count = COALESCE(retry_count, 0) + 1,
                     error_message = $2,
                     status = CASE WHEN COALESCE(retry_count, 0) >= 2 THEN 'failed' ELSE 'retry' END
                 WHERE email=$1 AND status IN ('sent','retry')
                 RETURNING campaign_id, contact_id`,
                [email, r.diagnosticCode || 'Soft bounce']
              );
              eventRows.push(...rows);
            } else {
              const rows = await q(
                `UPDATE campaign_recipients SET status='bounced', error_message=$2
                 WHERE email=$1 AND status IN ('sent','retry') RETURNING campaign_id, contact_id`,
                [email, r.diagnosticCode || (isPermanent ? 'Hard bounce' : 'Bounce')]
              );
              eventRows.push(...rows);
            }
          }

          if (eventRows.length) {
            const vals = eventRows.map((_, i) => `($${i*2+1},$${i*2+2},'bounce',NOW())`).join(',');
            await q(
              `INSERT INTO email_events (campaign_id, contact_id, type, created_at) VALUES ${vals}`,
              eventRows.flatMap(r => [r.campaign_id, r.contact_id])
            );
          }

          if (isPermanent) {
            const emails = recipients.map(r => r.emailAddress?.toLowerCase()).filter(Boolean);
            if (emails.length) {
              await q(
                `INSERT INTO suppression (email, reason) SELECT unnest($1::text[]), 'bounce' ON CONFLICT (email) DO NOTHING`,
                [emails]
              );
              await q(`UPDATE contacts SET status='bounced' WHERE email = ANY($1::text[])`, [emails]);
            }
          }
        });

      } else if (eventType === 'complaint') {
        const complaint = sesEvent.complaint || {};
        const recipients = complaint.complainedRecipients || [];

        await transaction(async (q) => {
          const eventRows = [];
          for (const r of recipients) {
            const email = r.emailAddress?.toLowerCase();
            if (!email) continue;
            const rows = await q(
              `UPDATE campaign_recipients SET status='failed' WHERE email=$1 AND status='sent' RETURNING campaign_id, contact_id`,
              [email]
            );
            eventRows.push(...rows);
          }

          if (eventRows.length) {
            const vals = eventRows.map((_, i) => `($${i*2+1},$${i*2+2},'spam',NOW())`).join(',');
            await q(
              `INSERT INTO email_events (campaign_id, contact_id, type, created_at) VALUES ${vals} ON CONFLICT DO NOTHING`,
              eventRows.flatMap(r => [r.campaign_id, r.contact_id])
            );
          }

          const emails = recipients.map(r => r.emailAddress?.toLowerCase()).filter(Boolean);
          if (emails.length) {
            await q(
              `INSERT INTO suppression (email, reason) SELECT unnest($1::text[]), 'spam' ON CONFLICT (email) DO NOTHING`,
              [emails]
            );
            await q(`UPDATE contacts SET status='complained' WHERE email = ANY($1::text[])`, [emails]);
          }
        });

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
        `INSERT INTO email_events (campaign_id, contact_id, type, url, created_at) VALUES ($1, $2, 'click', $3, NOW())`,
        [campaignId, contactId, url || null]
      );
    } catch (e) {
      console.error('track click error:', e.message);
    }
    return;
  }

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
      `INSERT INTO email_events (campaign_id, contact_id, type, created_at) VALUES ($1, $2, 'open', NOW())`,
      [campaignId, contactId]
    );
  } catch (e) {
    console.error('track open error:', e.message);
  }
};
