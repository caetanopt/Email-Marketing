const { query } = require('./db');
const { getSESClient } = require('./ses');
const { SendEmailCommand, GetSendQuotaCommand } = require('@aws-sdk/client-ses');
const crypto = require('crypto');
const { buildLegalFooter } = require('./emailFooter');

// Token do link "Versão web" — o mesmo que /api/track?action=preview valida.
function previewTokenFor(campaignId) {
  return crypto.createHmac('sha256', process.env.JWT_SECRET || '')
    .update(`preview:${campaignId}`).digest('hex');
}

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

const APP_URL = process.env.APP_URL || 'https://emkt.caetano.pt';
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

// Injects the campaign's preview_text (the snippet shown next to the
// subject in inbox lists like Gmail/Outlook) as a standard hidden
// preheader div — the exact markup MJML's own <mj-preview> compiles to.
// Done here rather than baked into the template's compiled html_content
// because preview_text is per-campaign, not per-template (the same
// template can be reused by campaigns with different preview text).
function injectPreviewText(html, previewText) {
  const text = (previewText || '').trim();
  if (!text) return html;
  const preheader = `<div style="display:none;font-size:1px;color:#ffffff;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">${escHtml(text)}</div>`;
  return /<body[^>]*>/i.test(html)
    ? html.replace(/(<body[^>]*>)/i, `$1${preheader}`)
    : preheader + html;
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
    // Diagnose: check if there are any recipients at all (might be inactive/suppressed)
    const [{ any_total }] = await query(
      `SELECT COUNT(*)::int AS any_total FROM campaign_recipients WHERE campaign_id=$1`, [campaignId]
    );
    const [{ list_count }] = await query(
      `SELECT COUNT(*)::int AS list_count FROM campaign_lists WHERE campaign_id=$1`, [campaignId]
    );
    if (any_total > 0) throw new Error('Sem destinatários activos — todos os contactos já foram enviados ou estão suprimidos');
    if (list_count > 0) throw new Error('Sem destinatários activos — as listas seleccionadas não têm contactos activos');
    throw new Error('Sem destinatários activos — adiciona contactos à campanha antes de enviar');
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
            b.name AS brand_name,
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

  // Batch size: how many recipients to claim per send_batch call.
  // With SES_RATE_PER_SECOND=50 and Vercel 60s timeout, cap at 2000 by default
  // (leaves headroom for DB queries). Set SES_BATCH_SIZE to override.
  const BATCH = parseInt(process.env.SES_BATCH_SIZE || '500', 10);
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

  // SES rate: read from global_settings DB first, fall back to env var, then default 50.
  // Na mesma leitura vem o disclaimer global e o logótipo do rodapé, usados
  // pelo rodapé legal de cada email deste lote.
  let ratePerSecFromDb = 0;
  let footerCfg = {};
  try {
    const gsRows = await query('SELECT ses_rate_per_second, disclaimer, footer_logo_url, footer_socials, email_width FROM global_settings WHERE id=1');
    ratePerSecFromDb = parseInt(gsRows[0]?.ses_rate_per_second, 10) || 0;
    footerCfg = gsRows[0] || {};
  } catch (_) {
    // Coluna/tabela em falta (migração ainda não corrida): o rodapé sai sem
    // disclaimer nem logótipo, mas a frase legal e os links mantêm-se.
    try {
      const gsRows = await query('SELECT ses_rate_per_second FROM global_settings WHERE id=1');
      ratePerSecFromDb = parseInt(gsRows[0]?.ses_rate_per_second, 10) || 0;
    } catch (_) {}
  }
  const RATE_PER_SEC = ratePerSecFromDb || parseInt(process.env.SES_RATE_PER_SECOND || '50', 10);
  const RATE = Math.min(parseInt(process.env.SES_RATE || '14', 10), RATE_PER_SEC);
  // Minimum ms to wait after each wave so we don't exceed RATE_PER_SEC.
  // e.g. 50/sec with RATE=14 → ceil(1000*14/50) = 280ms/wave
  const WAVE_DELAY_MS = Math.ceil((1000 * RATE) / RATE_PER_SEC);

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
        const unsubBlock = buildLegalFooter({
          globalDisclaimer: footerCfg.disclaimer,
          footerLogoUrl: footerCfg.footer_logo_url,
          footerSocials: footerCfg.footer_socials || {},
          width: footerCfg.email_width,
          brandName: c.brand_name,
          variables: c.variables || {},
          email: contact.email,
          unsubUrl,
          previewUrl: `${APP_URL}/api/preview?id=${campaignId}&token=${previewTokenFor(campaignId)}`,
        }) + `<img src="${pixelUrl}" width="1" height="1" border="0" style="display:block;width:1px;height:1px;border:0" alt="" />`;
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
        rawHtml = injectPreviewText(rawHtml, c.preview_text);
        const finalHtml = rawHtml.includes('</body>')
          ? rawHtml.replace('</body>', unsubBlock + '</body>')
          : rawHtml + unsubBlock;
        // Personalise subject line with the same variable set (no HTML escaping for subject)
        let personalizedSubject = c.subject || '(sem assunto)';
        for (const [k, v] of Object.entries(vars)) {
          const safeK = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          personalizedSubject = personalizedSubject.replace(new RegExp(`\\{\\{${safeK}\\}\\}`, 'g'), () => v || '');
        }
        personalizedSubject = personalizedSubject
          .replace(/\{\{name\}\}/g, () => contact.name || contact.email)
          .replace(/\{\{email\}\}/g, () => contact.email)
          .replace(/\{\{phone\}\}/g, () => contact.phone || '')
          .replace(/\{\{company\}\}/g, () => contact.company || '');
        if (contact.extra_data && typeof contact.extra_data === 'object') {
          for (const [k, v] of Object.entries(contact.extra_data)) {
            const safeK = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            personalizedSubject = personalizedSubject.replace(new RegExp(`\\{\\{${safeK}\\}\\}`, 'g'), () => v || '');
          }
        }
        const campAttachments = c.attachments || [];
        let msgId = null;
        if (campAttachments.length > 0) {
          const { SendRawEmailCommand } = require('@aws-sdk/client-ses');
          const rawMsg = buildRawEmail({
            fromName, fromEmail, toEmail: contact.email, replyTo,
            subject: personalizedSubject,
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
              Subject: { Charset: 'UTF-8', Data: personalizedSubject },
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
        // ── The email is now genuinely delivered (SES accepted it) ──────────
        // Everything below is DB bookkeeping only. A failure here must NEVER
        // be reclassified as a send failure (that risks a duplicate send to a
        // real customer on the next retry) — retry the bookkeeping write a
        // few times against transient DB blips, and if it still can't be
        // recorded, log loudly but still count the contact as sent.
        let recorded = false;
        for (let attempt = 0; attempt < 3 && !recorded; attempt++) {
          try {
            await query(
              "UPDATE campaign_recipients SET status='sent',message_id=$1,sent_at=NOW(),attempted_at=NOW(),error_message=NULL WHERE campaign_id=$2 AND contact_id=$3",
              [msgId, campaignId, contact.contact_id]
            );
            recorded = true;
          } catch (e1) {
            if (e1.code === '42703') {
              await query(
                "UPDATE campaign_recipients SET status='sent',message_id=$1,sent_at=NOW() WHERE campaign_id=$2 AND contact_id=$3",
                [msgId, campaignId, contact.contact_id]
              );
              recorded = true;
            } else if (attempt < 2) {
              await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
            } else {
              console.error(`Campaign ${campaignId}: contact ${contact.contact_id} — email DELIVERED (SES id ${msgId}) but failed to record status='sent' after retries:`, e1.message);
            }
          }
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
    // Always wait between waves — even before the last wave — to smooth out bursts.
    await new Promise(r => setTimeout(r, WAVE_DELAY_MS));
  }

  const [{ remaining }] = await query(
    "SELECT COUNT(*)::int AS remaining FROM campaign_recipients WHERE campaign_id=$1 AND status IN ('pending','retry')",
    [campaignId]
  );

  if (remaining === 0) {
    await query("UPDATE campaigns SET status='sent', sent_at=NOW() WHERE id=$1", [campaignId]);
    // NOTE: temp contacts (is_temp=true) used to be deleted here after a
    // completed send. Since campaign_recipients.contact_id has
    // ON DELETE CASCADE, that silently deleted the very campaign_recipients
    // rows just written — wiping the send report/log for that campaign
    // (0 sent, no error log, no activity) right after it was sent. Removed;
    // temp contacts are now kept so campaign reports stay intact.
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
      await sendCampaignCompletionNotification({
        campaignId,
        campaignName: c.name || `#${campaignId}`,
        brandId:      c.brand_id,
        brandName:    c.brand_name,
        totalSent:    totals.total_sent,
        totalFailed:  totals.total_failed,
      });
    } catch (err) { if (err.code !== '42P01') console.error('send log end:', err); }
  }

  if (batchState.quotaHit) {
    console.warn(`Campaign ${campaignId}: SES quota exhausted mid-batch. ${remaining} recipients pending — will resume after quota resets at midnight UTC.`);
    return { done: false, sent, failed, remaining, quotaExhausted: true };
  }

  return { done: remaining === 0, sent, failed, remaining };
}

// Sends a completion summary email to:
//  - global_settings.notification_emails (platform-wide)
//  - brands.notify_email for the campaign's brand (per-brand opt-in)
async function sendCampaignCompletionNotification({ campaignId, campaignName, brandId, brandName: brandNameArg, totalSent, totalFailed }) {
  try {
    let emails = [];
    let brandName = brandNameArg || '';
    try {
      const [globalRows, brandRows] = await Promise.all([
        query('SELECT notification_emails FROM global_settings WHERE id=1').catch(() => []),
        query('SELECT name, notify_email FROM brands WHERE id=$1', [brandId]).catch(() => []),
      ]);
      const globalRaw = globalRows[0]?.notification_emails || '';
      const globalEmails = globalRaw.split(',').map(e => e.trim()).filter(e => e.includes('@'));
      const brandNotify = brandRows[0]?.notify_email?.trim();
      if (!brandName && brandRows[0]?.name) brandName = brandRows[0].name;
      // Deduplicate: brand notify_email takes priority, global fills the rest
      const seen = new Set(globalEmails.map(e => e.toLowerCase()));
      if (brandNotify && brandNotify.includes('@')) {
        if (!seen.has(brandNotify.toLowerCase())) globalEmails.push(brandNotify);
      }
      emails = globalEmails;
    } catch (_) { return; }
    if (!emails.length) return;

    const APP_URL = (process.env.APP_URL || 'https://emkt.caetano.pt').replace(/\/$/, '');
    const from    = `Caetano <noreply@caetano.pt>`;
    const subject = `Campanha enviada: ${campaignName}`;
    const nowPt   = new Date().toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Lisbon' });

    // Generate stable preview token (same logic as api/preview.js)
    const previewToken = require('crypto')
      .createHmac('sha256', process.env.JWT_SECRET || '')
      .update(`preview:${campaignId}`).digest('hex');
    const previewUrl = `${APP_URL}/api/preview?id=${campaignId}&token=${previewToken}`;
    const reportUrl  = `${APP_URL}#campaigns/${campaignId}/report`;

    const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const failRow = totalFailed > 0
      ? `<tr><td style="padding:5px 0;font-family:Arial,sans-serif;font-size:14px;color:#9ca3af"><b style="color:#e5e7eb">Falhas:</b> <span style="color:#f87171">${totalFailed.toLocaleString('pt-PT')}</span></td></tr>`
      : '';

    const htmlBody = `<!DOCTYPE html>
<html lang="pt">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0d0d0d;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" bgcolor="#0d0d0d">
<tr><td align="center" style="padding:48px 20px">
<table width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%">

  <!-- Icon -->
  <tr><td align="center" style="padding-bottom:8px">
    <table cellpadding="0" cellspacing="0">
      <tr><td align="center" style="background:#ffffff;border-radius:16px;padding:20px 24px;width:80px">
        <p style="margin:0;font-size:48px;line-height:1">&#9993;</p>
      </td></tr>
      <tr><td align="center" style="padding-top:6px">
        <table cellpadding="0" cellspacing="0">
          <tr><td align="center" style="background:#22c55e;border-radius:50%;width:28px;height:28px;color:#ffffff;font-size:16px;font-weight:700;line-height:28px">&#10003;</td></tr>
        </table>
      </td></tr>
    </table>
  </td></tr>

  <!-- Title -->
  <tr><td align="center" style="padding:16px 0 8px">
    <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;font-family:Arial,sans-serif">A tua campanha foi enviada</h1>
  </td></tr>

  <!-- Subtitle -->
  <tr><td align="center" style="padding-bottom:32px">
    <p style="margin:0;color:#9ca3af;font-size:15px;font-family:Arial,sans-serif">A tua campanha foi enviada com sucesso para <b style="color:#ffffff">${totalSent.toLocaleString('pt-PT')}</b> destinatários!</p>
  </td></tr>

  <!-- Details card -->
  <tr><td style="background:#1f2937;border-radius:10px;padding:20px 24px">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:5px 0;font-family:Arial,sans-serif;font-size:14px;color:#9ca3af"><b style="color:#e5e7eb">Marca:</b> ${esc(brandName || '—')}</td></tr>
      <tr><td style="padding:5px 0;font-family:Arial,sans-serif;font-size:14px;color:#9ca3af"><b style="color:#e5e7eb">Campanha:</b> ${esc(campaignName)}</td></tr>
      <tr><td style="padding:5px 0;font-family:Arial,sans-serif;font-size:14px;color:#9ca3af"><b style="color:#e5e7eb">Destinatários:</b> ${totalSent.toLocaleString('pt-PT')}</td></tr>
      ${failRow}
      <tr><td style="padding:5px 0;font-family:Arial,sans-serif;font-size:14px;color:#9ca3af"><b style="color:#e5e7eb">Data/hora:</b> ${esc(nowPt)}</td></tr>
      <tr><td style="padding:5px 0;font-family:Arial,sans-serif;font-size:14px;color:#9ca3af"><b style="color:#e5e7eb">Versão web:</b> <a href="${previewUrl}" style="color:#60a5fa">${previewUrl}</a></td></tr>
      <tr><td style="padding:5px 0;font-family:Arial,sans-serif;font-size:14px;color:#9ca3af"><b style="color:#e5e7eb">Ver relatório:</b> <a href="${reportUrl}" style="color:#60a5fa">${reportUrl}</a></td></tr>
    </table>
  </td></tr>

  <!-- CTA -->
  <tr><td align="center" style="padding:32px 0 0">
    <a href="${reportUrl}" style="display:inline-block;padding:14px 36px;background:#2563eb;color:#ffffff;font-family:Arial,sans-serif;font-size:13px;font-weight:700;text-decoration:none;letter-spacing:.07em;text-transform:uppercase;border-radius:6px">VER RELATÓRIO DA CAMPANHA</a>
  </td></tr>

  <!-- Footer -->
  <tr><td align="center" style="padding:28px 0 0">
    <p style="margin:0;color:#4b5563;font-size:11px;font-family:Arial,sans-serif">Caetano eMKT</p>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`;

    const textBody = [
      `A tua campanha foi enviada`,
      ``,
      `Marca: ${brandName || '—'}`,
      `Campanha: ${campaignName}`,
      `Destinatários: ${totalSent}`,
      totalFailed > 0 ? `Falhas: ${totalFailed}` : null,
      `Data/hora: ${nowPt}`,
      ``,
      `Versão web: ${previewUrl}`,
      `Ver relatório: ${reportUrl}`,
    ].filter(l => l !== null).join('\n');

    const ses = getSESClient();
    for (const to of emails) {
      await ses.send(new SendEmailCommand({
        Source: from,
        Destination: { ToAddresses: [to] },
        Message: {
          Subject: { Charset: 'UTF-8', Data: subject },
          Body: {
            Html: { Charset: 'UTF-8', Data: htmlBody },
            Text: { Charset: 'UTF-8', Data: textBody },
          },
        },
      })).catch(err => console.error(`completion notify to ${to}:`, err.message));
    }
  } catch (err) {
    console.error('sendCampaignCompletionNotification:', err.message);
  }
}

module.exports = { initCampaignSend, runBatch, sendCampaignCompletionNotification, injectPreviewText };
