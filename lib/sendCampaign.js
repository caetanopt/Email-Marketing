const { query } = require('./db');
const { getSESClient } = require('./ses');
const { SendEmailCommand, GetSendQuotaCommand } = require('@aws-sdk/client-ses');
const crypto = require('crypto');

function buildRawEmail({ fromName, fromEmail, toEmail, replyTo, subject, htmlBody, textBody, attachments }) {
  const boundary = `==PM${Date.now()}${Math.random().toString(36).slice(2)}==`;
  const altBoundary = `==ALT${Date.now()}${Math.random().toString(36).slice(2)}==`;
  const encodeB = s => '=?UTF-8?B?' + Buffer.from(s, 'utf8').toString('base64') + '?=';
  const needsEncode = s => /[^\x20-\x7E]/.test(s);
  const hdrSubject = needsEncode(subject) ? encodeB(subject) : subject;
  const hdrFrom = needsEncode(fromName)
    ? `${encodeB(fromName)} <${fromEmail}>`
    : `${fromName} <${fromEmail}>`;

  const lines = [
    `MIME-Version: 1.0`,
    `From: ${hdrFrom}`,
    `To: ${toEmail}`,
    `Subject: ${hdrSubject}`,
    ...(replyTo ? [`Reply-To: ${replyTo}`] : []),
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    ``,
    `--${altBoundary}`,
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    Buffer.from(textBody, 'utf8').toString('base64'),
    ``,
    `--${altBoundary}`,
    `Content-Type: text/html; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    Buffer.from(htmlBody, 'utf8').toString('base64'),
    ``,
    `--${altBoundary}--`,
  ];

  for (const att of (attachments || [])) {
    const fname = needsEncode(att.name) ? encodeB(att.name) : att.name;
    lines.push(
      `--${boundary}`,
      `Content-Type: ${att.type || 'application/octet-stream'}; name="${fname}"`,
      `Content-Disposition: attachment; filename="${fname}"`,
      `Content-Transfer-Encoding: base64`,
      ``,
      att.data,  // já vem base64 do browser
      ``
    );
  }
  lines.push(`--${boundary}--`);
  return lines.join('\r\n');
}

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
  // Atomic claim: only the first concurrent caller transitions the campaign to
  // 'sending'. A second simultaneous call (browser double-click, cron overlap)
  // finds 0 rows and throws 'already_sending', which the caller surfaces as a
  // no-op rather than an error.
  const claimed = await query(
    `UPDATE campaigns SET status='sending' WHERE id=$1 AND status IN ('draft','scheduled') RETURNING *`,
    [campaignId]
  );
  if (!claimed[0]) {
    // Either the campaign doesn't exist or it's already being processed.
    const [existing] = await query(`SELECT id, status FROM campaigns WHERE id=$1`, [campaignId]);
    if (!existing) throw new Error('Campanha não encontrada');
    if (existing.status === 'sending') throw Object.assign(new Error('Campanha já está em envio'), { code: 'already_sending' });
    throw new Error(`Campanha não pode ser iniciada (status: ${existing.status})`);
  }
  const c = claimed[0];

  // Contacts from lists — deduplicate by email (DISTINCT ON).
  // As listas são globais (comuns a todas as marcas): a campanha envia para
  // todos os membros activos da lista, independentemente da marca do contacto.
  const listContacts = await query(
    `SELECT DISTINCT ON (lower(c.email)) c.id, c.email, c.name
     FROM contacts c
     JOIN list_members lm ON lm.contact_id=c.id
     JOIN campaign_lists cl ON cl.list_id=lm.list_id AND cl.campaign_id=$1
     WHERE c.status='active'
       AND lower(c.email) NOT IN (SELECT lower(email) FROM suppression WHERE email NOT LIKE '@%')
       AND '@' || split_part(lower(c.email),'@',2) NOT IN (SELECT lower(email) FROM suppression WHERE email LIKE '@%')
     ORDER BY lower(c.email), c.id`,
    [campaignId]
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
  if (!total) {
    // Revert — nothing to send; put the campaign back to draft so the user can fix it.
    await query("UPDATE campaigns SET status='draft' WHERE id=$1", [campaignId]);
    throw new Error('Sem destinatários activos');
  }

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
    `SELECT c.*, c.attachments, t.html_content,
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

  // Honour suppressions added after the recipients were built (mid-send
  // unsubscribes, direct imports) — never send to a suppressed address.
  try {
    await query(
      `UPDATE campaign_recipients cr
       SET status='failed', error_message='Endereço na lista de supressão', attempted_at=NOW()
       WHERE cr.campaign_id=$1 AND cr.status IN ('pending','retry')
         AND EXISTS (
           SELECT 1 FROM suppression s
           WHERE lower(s.email)=lower(cr.email)
              OR (s.email LIKE '@%' AND lower(s.email)='@'||split_part(lower(cr.email),'@',2))
         )`,
      [campaignId]
    );
  } catch (e) {
    if (e.code === '42703') {
      await query(
        `UPDATE campaign_recipients cr SET status='failed'
         WHERE cr.campaign_id=$1 AND cr.status IN ('pending','retry')
           AND EXISTS (
             SELECT 1 FROM suppression s
             WHERE lower(s.email)=lower(cr.email)
                OR (s.email LIKE '@%' AND lower(s.email)='@'||split_part(lower(cr.email),'@',2))
           )`,
        [campaignId]
      );
    } else { throw e; }
  }

  const BATCH = parseInt(process.env.SES_BATCH_SIZE || '50', 10);
  // Claim this batch atomically via UPDATE … RETURNING.
  // Two concurrent workers (cron + browser, or two overlapping cron invocations)
  // each run this UPDATE simultaneously. Because UPDATE acquires row-level locks,
  // only one worker will update each row — the other sees 0 affected rows for those
  // recipients and skips them via SKIP LOCKED. This prevents double-sends without
  // adding a new enum value: we reuse 'sending' (already exists on the campaigns
  // table) and temporarily stamp attempted_at so the stall detector ignores these rows.
  let claimedRows;
  try {
    claimedRows = await query(
      `WITH claimed AS (
         UPDATE campaign_recipients
         SET attempted_at = NOW()
         WHERE campaign_id = $1
           AND ctid IN (
             SELECT ctid FROM campaign_recipients
             WHERE campaign_id = $1 AND status IN ('pending','retry')
               AND (attempted_at IS NULL OR attempted_at < NOW() - INTERVAL '2 minutes')
             ORDER BY status DESC, contact_id ASC
             LIMIT $2
             FOR UPDATE SKIP LOCKED
           )
         RETURNING contact_id, email, retry_count
       )
       SELECT c.contact_id, c.email, c.retry_count,
              con.name, con.phone, con.company,
              COALESCE((
                SELECT jsonb_object_agg(key, value)
                FROM (
                  SELECT key, value
                  FROM list_members lm2
                  JOIN campaign_lists cl ON cl.list_id = lm2.list_id AND cl.campaign_id = $1
                  CROSS JOIN jsonb_each(COALESCE(lm2.extra_data, '{}'))
                  WHERE lm2.contact_id = c.contact_id
                ) ed
              ), '{}'::jsonb) AS extra_data
       FROM claimed c
       JOIN contacts con ON con.id = c.contact_id`,
      [campaignId, BATCH]
    );
  } catch (e) {
    // attempted_at column may not exist on older schemas — fall back to plain SELECT
    if (e.code !== '42703') throw e;
    claimedRows = await query(
      `SELECT cr.contact_id, cr.email, cr.retry_count,
              con.name, con.phone, con.company,
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
  }
  const pending = claimedRows;

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

  // Pre-flight: check SES daily quota before attempting any send.
  // If the quota is already exhausted, return immediately — recipients stay
  // 'pending' (the atomic claim only stamped attempted_at, not the status)
  // and will be picked up by the next cron invocation after midnight UTC
  // when the quota resets.
  let quotaRemaining = Infinity;
  try {
    const quotaInfo = await sesClient.send(new GetSendQuotaCommand({}));
    quotaRemaining = Math.max(0, Math.floor(quotaInfo.Max24HourSend - quotaInfo.SentLast24Hours));
    if (quotaRemaining < 1) {
      const [{ remaining }] = await query(
        "SELECT COUNT(*)::int AS remaining FROM campaign_recipients WHERE campaign_id=$1 AND status IN ('pending','retry')",
        [campaignId]
      );
      console.warn(`Campaign ${campaignId}: SES daily quota exhausted (${quotaInfo.SentLast24Hours}/${quotaInfo.Max24HourSend}). ${remaining} recipients pending until quota resets.`);
      return { done: false, sent: 0, failed: 0, remaining, quotaExhausted: true };
    }
  } catch (e) {
    // GetSendQuota failure (permissions, network) must not block the send —
    // we'll still attempt and let mid-send errors be caught below.
    console.warn('runBatch: quota pre-check failed, proceeding without limit:', e.message);
  }

  // Only send up to the available quota in this batch. Any claimed rows beyond
  // the quota limit stay 'pending' and are picked up by the next batch.
  const toSend = quotaRemaining < pending.length ? pending.slice(0, quotaRemaining) : pending;

  const fromName   = c.from_name  || c.brand_from_name  || 'eMKT';
  const fromEmail  = c.from_email || c.brand_from_email || `info@${FROM_DOMAIN}`;
  const replyTo    = c.reply_to   || c.brand_reply_to   || undefined;

  const utmParams = c.utm_params || {};
  const utmStr = Object.entries(utmParams).filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

  // Wraps every external link with a click-tracking redirect, then appends UTM params
  function injectTracking(html, campaignId, contactId) {
    return html.replace(/href="(https?:\/\/[^"]+)"/gi, (match, rawUrl) => {
      const url = rawUrl
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"');
      if (url.includes('action=unsubscribe') || url.includes('action=resubscribe')) return match;
      if (url.includes('/api/track?')) return match;
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
  // Shared flag: set to true when a daily-quota error is detected mid-batch.
  // Any contact whose send is skipped stays 'pending' (status never changed).
  const batchState = { quotaHit: false };

  for (let i = 0; i < toSend.length; i += RATE) {
    if (batchState.quotaHit) break;
    await Promise.all(toSend.slice(i, i + RATE).map(async contact => {
      if (batchState.quotaHit) return; // skip remaining contacts in this rate group
      try {
        const token = unsubToken(contact.email, c.brand_id);
        const unsubUrl = `${APP_URL}/api/suppression?brand_id=${c.brand_id}&action=unsubscribe&c=${campaignId}&email=${encodeURIComponent(contact.email)}&token=${token}`;
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
        const campAttachments = c.attachments || [];
        let msgId = null;
        if (campAttachments.length > 0) {
          const { SendRawEmailCommand } = require('@aws-sdk/client-ses');
          const rawMsg = buildRawEmail({
            fromName, fromEmail, toEmail: contact.email, replyTo,
            subject: c.subject || '(sem assunto)',
            htmlBody: finalHtml,
            textBody: htmlToText(finalHtml) + `\n\nCancelar subscrição: ${unsubUrl}`,
            attachments: campAttachments,
          });
          const rawCmd = new SendRawEmailCommand({
            RawMessage: { Data: Buffer.from(rawMsg) },
            Tags: [
              { Name: 'campaign_id', Value: String(campaignId) },
              { Name: 'contact_id',  Value: String(contact.contact_id) },
            ],
          });
          const info = await sesClient.send(rawCmd);
          msgId = info?.MessageId || null;
        } else {
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
          msgId = info?.MessageId || null;
        }
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
        // Daily quota exhausted — leave recipient as 'pending' (status never changed
        // by the atomic claim). It will be sent automatically when the quota resets
        // at midnight UTC. Do NOT count as failed or retry.
        const isQuotaError = /Daily message quota exceeded|quota.*exceeded|DailyQuota/i.test(errMsg)
          || err?.name === 'LimitExceededException';
        if (isQuotaError) {
          console.warn(`Campaign ${campaignId}: daily quota hit at contact ${contact.contact_id} — pausing batch.`);
          batchState.quotaHit = true;
          return;
        }
        // Classify error: transient SES/network errors get a retry (up to 2 attempts)
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
    if (batchState.quotaHit) break;
    if (i + RATE < toSend.length) await new Promise(r => setTimeout(r, 1000));
  }

  const [{ remaining }] = await query(
    "SELECT COUNT(*)::int AS remaining FROM campaign_recipients WHERE campaign_id=$1 AND status IN ('pending','retry')",
    [campaignId]
  );

  if (remaining === 0) {
    await query("UPDATE campaigns SET status='sent', sent_at=NOW() WHERE id=$1", [campaignId]);
    try {
      await query(
        `DELETE FROM contacts
         WHERE id IN (
           SELECT cr.contact_id FROM campaign_recipients cr
           WHERE cr.campaign_id = $1 AND cr.is_temp = true
             AND NOT EXISTS (SELECT 1 FROM list_members lm WHERE lm.contact_id = cr.contact_id)
         )`,
        [campaignId]
      );
    } catch (e) { if (e.code !== '42703') console.error('temp contact cleanup:', e); }
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

  if (batchState.quotaHit) {
    console.warn(`Campaign ${campaignId}: SES quota exhausted mid-batch. ${remaining} recipients pending — will resume after quota resets at midnight UTC.`);
    return { done: false, sent, failed, remaining, quotaExhausted: true };
  }

  return { done: remaining === 0, sent, failed, remaining };
}

module.exports = { initCampaignSend, runBatch };
