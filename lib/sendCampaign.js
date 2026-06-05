const { query } = require('./db');
const { getSESClient } = require('./ses');
const { SendEmailCommand } = require('@aws-sdk/client-ses');
const crypto = require('crypto');

const APP_URL = process.env.APP_URL || 'https://email-marketing-eta.vercel.app';
const FROM_DOMAIN = process.env.FROM_DOMAIN || 'caetano.pt';
const DEFAULT_COMPANY_ADDRESS = process.env.COMPANY_ADDRESS || 'Rua do Barreiro, 547 4409-513 Vila Nova de Gaia';

function trackToken(campaignId, contactId) {
  return crypto.createHmac('sha256', process.env.JWT_SECRET)
    .update(`track:${campaignId}:${contactId}`)
    .digest('hex');
}

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function unsubToken(email, brandId) {
  return crypto.createHmac('sha256', process.env.JWT_SECRET)
    .update(`${email}:${brandId}`)
    .digest('hex');
}

function htmlToText(html) {
  return (html || '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Initialise a campaign send: build recipients from lists, count pending, set status='sending'.
 * Does NOT require user auth — safe to call from cron.
 * @param {number|string} campaignId
 * @returns {{ total: number, campaign: object }}
 */
async function initCampaignSend(campaignId) {
  // Read campaign without user_brand_roles join (cron has no user)
  const campaigns = await query(
    `SELECT c.* FROM campaigns c WHERE c.id = $1`,
    [campaignId]
  );
  const c = campaigns[0];
  if (!c) throw new Error('Campanha não encontrada');

  // Contacts from lists — deduplicate by email (DISTINCT ON)
  const listContacts = await query(
    `SELECT DISTINCT ON (lower(c.email)) c.id, c.email, c.name
     FROM contacts c
     JOIN list_members lm ON lm.contact_id=c.id
     JOIN campaign_lists cl ON cl.list_id=lm.list_id AND cl.campaign_id=$1
     WHERE c.brand_id=$2 AND c.status='active'
       AND lower(c.email) NOT IN (SELECT lower(email) FROM suppression)
     ORDER BY lower(c.email), c.id`,
    [campaignId, c.brand_id]
  );
  if (listContacts.length) {
    const vals = listContacts.map((_, i) => `($${i*3+1},$${i*3+2},$${i*3+3})`).join(',');
    await query(
      `INSERT INTO campaign_recipients (campaign_id,contact_id,email) VALUES ${vals} ON CONFLICT (campaign_id,contact_id) DO NOTHING`,
      listContacts.flatMap(ct => [campaignId, ct.id, ct.email])
    );
  }

  // Count total pending (lists + direct imports)
  const [{ total }] = await query(
    `SELECT COUNT(*)::int AS total FROM campaign_recipients WHERE campaign_id=$1 AND status='pending'`,
    [campaignId]
  );
  if (!total) throw new Error('Sem destinatários activos');

  await query("UPDATE campaigns SET status='sending' WHERE id=$1", [campaignId]);

  return { total, campaign: c };
}

/**
 * Send one batch of pending recipients for a campaign.
 * Does NOT require user auth — safe to call from cron.
 * @param {number|string} campaignId
 * @param {number|null} actorId  — for logging; can be null
 * @returns {{ done: boolean, sent: number, failed: number, remaining: number, warning?: string }}
 */
async function runBatch(campaignId, actorId = null) {
  // Read campaign+template+brand without user_brand_roles join
  const camp = await query(
    `SELECT c.*, t.html_content,
            b.from_name AS brand_from_name, b.from_email AS brand_from_email,
            b.reply_to AS brand_reply_to, b.variables
     FROM campaigns c
     LEFT JOIN templates t ON t.id=c.template_id
     LEFT JOIN brands b ON b.id=c.brand_id
     WHERE c.id=$1`,
    [campaignId]
  );
  if (!camp[0]) throw new Error('Campanha não encontrada');

  if (camp[0].status === 'sent') {
    return { done: true, sent: 0, failed: 0, remaining: 0 };
  }
  if (camp[0].status !== 'sending') {
    throw new Error(`Campanha não está em envio (status: ${camp[0].status})`);
  }

  const BATCH = parseInt(process.env.SES_BATCH_SIZE || '50', 10);
  // Pick up both fresh pending contacts and soft-bounce retries
  const pending = await query(
    `SELECT cr.contact_id, cr.email, con.name, con.phone, con.company, cr.retry_count,
            COALESCE((
              SELECT jsonb_object_agg(key, value)
              FROM (
                SELECT key, value
                FROM list_members lm2
                JOIN campaign_lists cl ON cl.list_id = lm2.list_id AND cl.campaign_id = $1
                CROSS JOIN jsonb_each(COALESCE(lm2.extra_data, '{}'))
                WHERE lm2.contact_id = cr.contact_id
              ) ed
            ), '{}'::jsonb) AS extra_data
     FROM campaign_recipients cr
     JOIN contacts con ON con.id = cr.contact_id
     WHERE cr.campaign_id = $1 AND cr.status IN ('pending','retry')
     ORDER BY cr.status DESC, cr.contact_id ASC
     LIMIT $2`,
    [campaignId, BATCH]
  );

  if (!pending.length) {
    await query("UPDATE campaigns SET status='sent', sent_at=NOW() WHERE id=$1", [campaignId]);
    return { done: true, sent: 0, failed: 0, remaining: 0 };
  }

  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    await query(
      "UPDATE campaign_recipients SET status='sent', sent_at=NOW() WHERE campaign_id=$1 AND status='pending'",
      [campaignId]
    );
    await query("UPDATE campaigns SET status='sent', sent_at=NOW() WHERE id=$1", [campaignId]);
    return { done: true, sent: pending.length, failed: 0, remaining: 0, warning: 'AWS SES não configurado' };
  }

  const c = camp[0];
  const sesClient = getSESClient();

  const fromName   = c.from_name  || c.brand_from_name  || 'PrimeMail';
  const fromEmail  = c.from_email || c.brand_from_email || `info@${FROM_DOMAIN}`;
  const replyTo    = c.reply_to   || c.brand_reply_to   || undefined;

  const utmParams = c.utm_params || {};
  const utmStr = Object.entries(utmParams).filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

  // Wraps every external link with a click-tracking redirect, then appends UTM params
  function injectTracking(html, campaignId, contactId) {
    return html.replace(/href="(https?:\/\/[^"]+)"/gi, (match, rawUrl) => {
      // Decode HTML entities that esc() may have introduced (& → &amp;, etc.)
      const url = rawUrl
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"');
      // Never wrap unsubscribe / resubscribe links or already-wrapped tracking links
      if (url.includes('action=unsubscribe') || url.includes('action=resubscribe')) return match;
      if (url.includes('/api/track?')) return match; // already wrapped — skip
      // Build final destination URL (with UTM if configured)
      let dest = url;
      if (utmStr) {
        const sep = dest.includes('?') ? '&' : '?';
        dest = `${dest}${sep}${utmStr}`;
      }
      const tok = trackToken(campaignId, contactId);
      const redirect = `${APP_URL}/api/track?type=click&cid=${campaignId}&uid=${contactId}&t=${tok}&url=${encodeURIComponent(dest)}`;
      return `href="${redirect}"`;
    });
  }

  const RATE = parseInt(process.env.SES_RATE || '14', 10);
  let sent = 0, failed = 0;

  for (let i = 0; i < pending.length; i += RATE) {
    await Promise.all(pending.slice(i, i + RATE).map(async contact => {
      try {
        const token = unsubToken(contact.email, c.brand_id);
        const unsubUrl = `${APP_URL}/api/suppression?brand_id=${c.brand_id}&action=unsubscribe&email=${encodeURIComponent(contact.email)}&token=${token}`;
        const trackTok = trackToken(campaignId, contact.contact_id);
        const pixelUrl = `${APP_URL}/api/track?type=open&cid=${campaignId}&uid=${contact.contact_id}&t=${trackTok}`;
        const unsubBlock = `<div style="text-align:center;padding:20px;font-family:sans-serif;font-size:11px;color:#999">
          <a href="${unsubUrl}" style="color:#999">Cancelar subscrição</a>
        </div><img src="${pixelUrl}" width="1" height="1" border="0" style="display:block;width:1px;height:1px;border:0" alt="" />`;
        const vars = { company_address: DEFAULT_COMPANY_ADDRESS, ...(c.variables || {}) };
        // Guard: if html_content is MJML (legacy), log a warning — template needs re-saving
        const rawContent = c.html_content || '';
        if (rawContent.trimStart().startsWith('<mjml>')) {
          console.warn(`Campaign ${campaignId}: template stored as MJML — re-save to convert to HTML.`);
        }
        let rawHtml = rawContent;
        // Use function replacer to avoid $& / $1 interpolation on variable values
        for (const [k, v] of Object.entries(vars)) {
          const safeK = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          rawHtml = rawHtml.replace(new RegExp(`\\{\\{${safeK}\\}\\}`, 'g'), () => escHtml(v || ''));
        }
        rawHtml = rawHtml
          .replace(/\{\{name\}\}/g, () => escHtml(contact.name || contact.email))
          .replace(/\{\{email\}\}/g, () => escHtml(contact.email))
          .replace(/\{\{phone\}\}/g, () => escHtml(contact.phone || ''))
          .replace(/\{\{company\}\}/g, () => escHtml(contact.company || ''))
          .replace(/\{\{unsubscribe_url\}\}/g, () => unsubUrl);
        // Replace list extra_data fields (e.g. {{cargo}}, {{departamento}})
        if (contact.extra_data && typeof contact.extra_data === 'object') {
          for (const [k, v] of Object.entries(contact.extra_data)) {
            const safeK = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            rawHtml = rawHtml.replace(new RegExp(`\\{\\{${safeK}\\}\\}`, 'g'), () => escHtml(v || ''));
          }
        }
        rawHtml = injectTracking(rawHtml, campaignId, contact.contact_id);
        const finalHtml = rawHtml.includes('</body>')
          ? rawHtml.replace('</body>', unsubBlock + '</body>')
          : rawHtml + unsubBlock;
        const sesCmd = new SendEmailCommand({
          Source: `${fromName} <${fromEmail}>`,
          Destination: { ToAddresses: [contact.email] },
          Message: {
            Subject: { Charset: 'UTF-8', Data: c.subject || '(sem assunto)' },
            Body: {
              Html: { Charset: 'UTF-8', Data: finalHtml },
              Text: { Charset: 'UTF-8', Data: htmlToText(finalHtml) + `\n\nCancelar subscrição: ${unsubUrl}` },
            },
          },
          ...(replyTo ? { ReplyToAddresses: [replyTo] } : {}),
          Tags: [
            { Name: 'campaign_id', Value: String(campaignId) },
            { Name: 'contact_id',  Value: String(contact.contact_id) },
          ],
        });
        const info = await sesClient.send(sesCmd);
        const msgId = info?.MessageId || null;
        try {
          await query(
            "UPDATE campaign_recipients SET status='sent',message_id=$1,sent_at=NOW(),attempted_at=NOW(),error_message=NULL WHERE campaign_id=$2 AND contact_id=$3",
            [msgId, campaignId, contact.contact_id]
          );
        } catch (e1) {
          if (e1.code === '42703') {
            await query(
              "UPDATE campaign_recipients SET status='sent',message_id=$1,sent_at=NOW() WHERE campaign_id=$2 AND contact_id=$3",
              [msgId, campaignId, contact.contact_id]
            );
          } else { throw e1; }
        }
        try {
          await query(
            `INSERT INTO email_send_log (brand_id, campaign_id, contact_id, email, event_type, message_id, created_by)
             VALUES ($1,$2,$3,$4,'sent',$5,$6)`,
            [c.brand_id, campaignId, contact.contact_id, contact.email, msgId, actorId]
          );
        } catch (err) { if (err.code !== '42P01') console.error('send log:', err); }
        sent++;
      } catch (err) {
        console.error('SES send error:', err?.message);
        const errMsg = (err?.message || 'unknown').slice(0, 500);
        // Classify error: transient SES/network errors get a retry (up to 3 attempts)
        const isTransient = /Throttling|ServiceUnavailable|RequestTimeout|ECONNRESET|ETIMEDOUT/i.test(errMsg);
        const currentRetry = contact.retry_count || 0;
        const newStatus = (isTransient && currentRetry < 2) ? 'retry' : 'failed';
        try {
          await query(
            `UPDATE campaign_recipients
             SET status=$4::recipient_status, attempted_at=NOW(), error_message=$3,
                 retry_count = COALESCE(retry_count,0) + CASE WHEN $4::text='retry' THEN 1 ELSE 0 END
             WHERE campaign_id=$1 AND contact_id=$2`,
            [campaignId, contact.contact_id, errMsg, newStatus]
          );
        } catch (e2) {
          if (e2.code === '42703') {
            await query(
              "UPDATE campaign_recipients SET status='failed' WHERE campaign_id=$1 AND contact_id=$2",
              [campaignId, contact.contact_id]
            );
          } else { throw e2; }
        }
        try {
          await query(
            `INSERT INTO email_send_log (brand_id, campaign_id, contact_id, email, event_type, error, created_by)
             VALUES ($1,$2,$3,$4,'failed',$5,$6)`,
            [c.brand_id, campaignId, contact.contact_id, contact.email, errMsg, actorId]
          );
        } catch (err) { if (err.code !== '42P01') console.error('send log:', err); }
        failed++;
      }
    }));
    if (i + RATE < pending.length) await new Promise(r => setTimeout(r, 1000));
  }

  const [{ remaining }] = await query(
    "SELECT COUNT(*)::int AS remaining FROM campaign_recipients WHERE campaign_id=$1 AND status IN ('pending','retry')",
    [campaignId]
  );

  if (remaining === 0) {
    await query("UPDATE campaigns SET status='sent', sent_at=NOW() WHERE id=$1", [campaignId]);
    try {
      const [totals] = await query(
        `SELECT COUNT(*) FILTER (WHERE status='sent')::int AS total_sent,
                COUNT(*) FILTER (WHERE status='failed')::int AS total_failed
         FROM campaign_recipients WHERE campaign_id=$1`, [campaignId]
      );
      await query(
        `INSERT INTO email_send_log (brand_id, campaign_id, email, event_type, created_by)
         VALUES ($1,$2,$3,'campaign_completed',$4)`,
        [c.brand_id, campaignId, `enviados=${totals.total_sent} falhados=${totals.total_failed}`, actorId]
      );
    } catch (err) { if (err.code !== '42P01') console.error('send log end:', err); }
  }

  return { done: remaining === 0, sent, failed, remaining };
}

module.exports = { initCampaignSend, runBatch };
