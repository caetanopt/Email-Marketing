const { query } = require('../lib/db');
const crypto = require('crypto');

// Verify AWS SNS message signature (optional but recommended)
function rawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  // Allow OPTIONS preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-amz-sns-message-type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const msgType = req.headers['x-amz-sns-message-type'] || '';

    // Parse body
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
        await fetch(url); // confirm the subscription
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
          // Hard bounce — mark bounced, suppress globally
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
          // Soft bounce — schedule retry (up to 3 attempts), then fail
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
          // Unknown bounce type — treat as hard
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
        // Spam complaints → suppress globally
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
};
