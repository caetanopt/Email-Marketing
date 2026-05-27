const { query } = require('../../lib/db');
const { requireAuth, cors } = require('../../lib/auth');
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const crypto = require('crypto');

function unsubToken(email, brandId) {
  return crypto.createHmac('sha256', process.env.JWT_SECRET)
    .update(`${email}:${brandId}`)
    .digest('hex');
}

async function authorizeCampaign(userId, campaignId) {
  const r = await query(
    `SELECT c.*
     FROM campaigns c
     JOIN user_brand_roles ubr ON ubr.brand_id = c.brand_id AND ubr.user_id = $2
     WHERE c.id = $1`,
    [campaignId, userId]
  );
  return r[0] || null;
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

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  const user = requireAuth(req, res);
  if (!user) return;

  const { id, action } = req.query;

  try {
    const camp = await authorizeCampaign(user.id, id);
    if (!camp) return res.status(404).json({ error: 'Campanha não encontrada' });

    if (req.method === 'GET' && action === 'get_direct_recipients') {
      const recs = await query(
        `SELECT cr.email, c.name AS contact_name
         FROM campaign_recipients cr
         LEFT JOIN contacts c ON c.id = cr.contact_id
         WHERE cr.campaign_id = $1
         ORDER BY cr.id DESC LIMIT 500`,
        [id]
      );
      return res.status(200).json({ recipients: recs });
    }

    if (req.method === 'GET' && action === 'send_log') {
      // Per-recipient status (sent/failed/bounced) for this campaign
      let recipients;
      try {
        recipients = await query(
          `SELECT cr.email, cr.status, cr.message_id, cr.sent_at, cr.attempted_at, cr.error_message,
                  ct.name AS contact_name, ct.id AS contact_id
           FROM campaign_recipients cr
           LEFT JOIN contacts ct ON ct.id = cr.contact_id
           WHERE cr.campaign_id = $1 ORDER BY COALESCE(cr.attempted_at, cr.sent_at) DESC NULLS LAST LIMIT 500`,
          [id]
        );
      } catch (e) {
        if (e.code === '42703') {
          recipients = await query(
            `SELECT cr.email, cr.status, cr.message_id, cr.sent_at,
                    NULL::timestamptz AS attempted_at, NULL::text AS error_message,
                    ct.name AS contact_name, ct.id AS contact_id
             FROM campaign_recipients cr
             LEFT JOIN contacts ct ON ct.id = cr.contact_id
             WHERE cr.campaign_id = $1 ORDER BY cr.sent_at DESC NULLS LAST LIMIT 500`,
            [id]
          );
        } else { throw e; }
      }
      let events = [];
      try {
        events = await query(
          `SELECT email, event_type, message_id, error, created_at
           FROM email_send_log WHERE campaign_id = $1 ORDER BY created_at DESC LIMIT 200`,
          [id]
        );
      } catch (e) {
        if (e.code !== '42P01') throw e;
      }
      return res.status(200).json({ recipients, events });
    }

    // ── Error log: only failed/bounced/retry with detail, higher limit ──
    if (req.method === 'GET' && action === 'error_log') {
      const errors = await query(
        `SELECT cr.email, cr.status, cr.error_message, cr.retry_count,
                cr.attempted_at, ct.name AS contact_name, ct.id AS contact_id
         FROM campaign_recipients cr
         LEFT JOIN contacts ct ON ct.id = cr.contact_id
         WHERE cr.campaign_id = $1
           AND cr.status IN ('failed','bounced','retry')
           AND cr.error_message IS NOT NULL
         ORDER BY cr.attempted_at DESC NULLS LAST
         LIMIT 2000`,
        [id]
      );
      const [{ total_errors }] = await query(
        `SELECT COUNT(*)::int AS total_errors FROM campaign_recipients
         WHERE campaign_id=$1 AND status IN ('failed','bounced','retry')`, [id]
      );
      return res.status(200).json({ errors, total_errors });
    }

    if (req.method === 'GET') {
      if (action === 'report') {
        const camp = [await authorizeCampaign(user.id, id)];
        if (!camp[0]) return res.status(404).json({ error: 'Campanha não encontrada' });

        const [counts] = await query(
          `SELECT COUNT(*)::int AS total,
                  COUNT(*) FILTER (WHERE status='sent')::int AS sent,
                  COUNT(*) FILTER (WHERE status='failed')::int AS failed,
                  COUNT(*) FILTER (WHERE status='bounced')::int AS bounced,
                  COUNT(*) FILTER (WHERE status='suppressed')::int AS suppressed
           FROM campaign_recipients WHERE campaign_id=$1`, [id]
        );
        const [opens] = await query(
          `SELECT COUNT(*)::int AS total, COUNT(DISTINCT contact_id)::int AS unique_count
           FROM email_events WHERE campaign_id=$1 AND type='open'`, [id]
        );
        const [clicks] = await query(
          `SELECT COUNT(*)::int AS total, COUNT(DISTINCT contact_id)::int AS unique_count
           FROM email_events WHERE campaign_id=$1 AND type='click'`, [id]
        );
        const [unsubs] = await query(
          "SELECT COUNT(*)::int AS total FROM email_events WHERE campaign_id=$1 AND type='unsubscribe'", [id]
        );
        const [spam] = await query(
          "SELECT COUNT(*)::int AS total FROM email_events WHERE campaign_id=$1 AND type='spam'", [id]
        );
        const top_links = await query(
          `SELECT url, COUNT(*)::int AS clicks, COUNT(DISTINCT contact_id)::int AS unique_clicks
           FROM email_events WHERE campaign_id=$1 AND type='click' AND url IS NOT NULL
           GROUP BY url ORDER BY clicks DESC LIMIT 10`, [id]
        );
        const timeseries = await query(
          `SELECT date_trunc('hour', created_at) AS bucket,
                  COUNT(*) FILTER (WHERE type='open')::int AS opens,
                  COUNT(*) FILTER (WHERE type='click')::int AS clicks
           FROM email_events
           WHERE campaign_id=$1 AND type IN ('open','click')
           GROUP BY bucket ORDER BY bucket LIMIT 168`, [id]
        );
        const segments = await query(
          `SELECT l.id, l.name,
                  COUNT(DISTINCT cr.contact_id)::int AS sent,
                  COUNT(DISTINCT ee.contact_id) FILTER (WHERE ee.type='open')::int AS opens,
                  COUNT(DISTINCT ee.contact_id) FILTER (WHERE ee.type='click')::int AS clicks
           FROM campaign_lists cl
           JOIN lists l ON l.id = cl.list_id
           JOIN list_members lm ON lm.list_id = l.id
           JOIN campaign_recipients cr ON cr.campaign_id = cl.campaign_id AND cr.contact_id = lm.contact_id AND cr.status='sent'
           LEFT JOIN email_events ee ON ee.campaign_id = cl.campaign_id AND ee.contact_id = lm.contact_id
           WHERE cl.campaign_id = $1
           GROUP BY l.id, l.name
           ORDER BY sent DESC`, [id]
        );
        const compare = await query(
          `WITH last_camps AS (
             SELECT id, name, sent_at
             FROM campaigns
             WHERE brand_id = $1 AND status = 'sent'
             ORDER BY sent_at DESC NULLS LAST LIMIT 5
           )
           SELECT lc.id, lc.name, lc.sent_at,
                  COUNT(cr.*) FILTER (WHERE cr.status='sent')::int AS sent,
                  COUNT(cr.*)::int AS total_recipients,
                  COUNT(DISTINCT ee.contact_id) FILTER (WHERE ee.type='open')::int AS unique_opens,
                  COUNT(DISTINCT ee.contact_id) FILTER (WHERE ee.type='click')::int AS unique_clicks,
                  COUNT(*) FILTER (WHERE ee.type='unsubscribe')::int AS unsubs
           FROM last_camps lc
           LEFT JOIN campaign_recipients cr ON cr.campaign_id = lc.id
           LEFT JOIN email_events ee ON ee.campaign_id = lc.id
           GROUP BY lc.id, lc.name, lc.sent_at
           ORDER BY lc.sent_at DESC NULLS LAST`,
          [camp[0].brand_id]
        );

        const delivered = counts?.sent || 0;
        const openUniq  = opens?.unique_count || 0;
        const clickUniq = clicks?.unique_count || 0;

        return res.status(200).json({
          campaign: camp[0],
          delivery: {
            total: counts?.total||0, sent: delivered,
            failed: counts?.failed||0, bounced: counts?.bounced||0, suppressed: counts?.suppressed||0,
            delivery_rate: delivered && counts?.total ? ((delivered/counts.total)*100).toFixed(1) : 0,
          },
          engagement: {
            opens: opens?.total||0, unique_opens: openUniq,
            clicks: clicks?.total||0, unique_clicks: clickUniq,
            open_rate:  delivered ? ((openUniq/delivered)*100).toFixed(1) : 0,
            click_rate: delivered ? ((clickUniq/delivered)*100).toFixed(1) : 0,
            ctor:       openUniq  ? ((clickUniq/openUniq)*100).toFixed(1)  : 0,
            unsubscribes: unsubs?.total||0,
            spam_complaints: spam?.total||0,
          },
          top_links,
          timeseries,
          segments,
          compare,
        });
      }

      const rows = await query(
        `SELECT c.*, t.html_content, t.name AS template_name
         FROM campaigns c LEFT JOIN templates t ON t.id=c.template_id WHERE c.id=$1`, [id]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Campanha não encontrada' });

      const lists = await query(
        `SELECT l.id, l.name, COUNT(lm.contact_id)::int AS total
         FROM campaign_lists cl JOIN lists l ON l.id=cl.list_id
         LEFT JOIN list_members lm ON lm.list_id=l.id
         WHERE cl.campaign_id=$1 GROUP BY l.id`, [id]
      );
      const [{ direct_count }] = await query(
        `SELECT COUNT(*)::int AS direct_count FROM campaign_recipients WHERE campaign_id=$1`,
        [id]
      );
      return res.status(200).json({ ...rows[0], lists, direct_count: direct_count || 0 });
    }

    if (req.method === 'PUT') {
      if (camp.status === 'sent') return res.status(409).json({ error: 'Não é possível editar uma campanha já enviada.' });
      const { name, subject, preview_text, from_name, from_email,
              template_id, scheduled_at, status, list_ids } = req.body || {};
      await query(
        `UPDATE campaigns SET name=COALESCE($1,name), subject=$2, preview_text=$3,
         from_name=$4, from_email=$5, template_id=COALESCE($6,template_id),
         scheduled_at=$7, status=COALESCE($8,status), updated_at=NOW() WHERE id=$9 AND brand_id=$10`,
        [name||null, subject||null, preview_text||null, from_name||null, from_email||null,
         template_id||null, scheduled_at||null, status||null, id, camp.brand_id]
      );
      if (list_ids) {
        if (list_ids.length) {
          const owned = await query(
            `SELECT id FROM lists WHERE id = ANY($1::int[]) AND brand_id = $2`,
            [list_ids, camp.brand_id]
          );
          if (owned.length !== list_ids.length) return res.status(400).json({ error: 'Uma ou mais listas não pertencem a esta marca' });
        }
        await query('DELETE FROM campaign_lists WHERE campaign_id=$1', [id]);
        if (list_ids.length) {
          const vals = list_ids.map((_, i) => `($${i*2+1},$${i*2+2})`).join(',');
          await query(`INSERT INTO campaign_lists (campaign_id,list_id) VALUES ${vals}`,
            list_ids.flatMap(lid => [id, lid]));
        }
      }
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      await query('DELETE FROM campaigns WHERE id=$1 AND brand_id=$2', [id, camp.brand_id]);
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'POST') {

      // ── Adicionar destinatários directos (sem lista) ────────────
      if (action === 'add_direct_recipients') {
        const { contact_ids } = req.body || {};
        if (!Array.isArray(contact_ids) || !contact_ids.length)
          return res.status(400).json({ error: 'contact_ids obrigatório' });
        const contacts = await query(
          `SELECT id, email FROM contacts WHERE id = ANY($1::int[]) AND brand_id=$2`,
          [contact_ids, camp.brand_id]
        );
        if (!contacts.length) return res.status(200).json({ ok: true, added: 0 });
        const vals = contacts.map((_, i) => `($${i*3+1},$${i*3+2},$${i*3+3},'pending')`).join(',');
        await query(
          `INSERT INTO campaign_recipients (campaign_id,contact_id,email,status) VALUES ${vals} ON CONFLICT (campaign_id,contact_id) DO NOTHING`,
          contacts.flatMap(ct => [id, ct.id, ct.email])
        );
        return res.status(200).json({ ok: true, added: contacts.length });
      }

      // ── Cancelar/interromper envio ───────────────────────────
      if (action === 'cancel_send') {
        const camp = await query(
          `SELECT c.* FROM campaigns c
           JOIN user_brand_roles ubr ON ubr.brand_id = c.brand_id AND ubr.user_id = $2
           WHERE c.id=$1`, [id, user.id]
        );
        if (!camp[0]) return res.status(404).json({ error: 'Campanha não encontrada' });
        if (!['sending','scheduled'].includes(camp[0].status))
          return res.status(409).json({ error: 'Apenas campanhas em envio ou agendadas podem ser canceladas.' });
        // Reset to draft — pending recipients are left as-is (can resend later)
        await query(`UPDATE campaigns SET status='draft', sent_at=NULL WHERE id=$1`, [id]);
        await query(`UPDATE campaign_recipients SET status='pending' WHERE campaign_id=$1 AND status='pending'`, [id]);
        try {
          await query(
            `INSERT INTO email_send_log (brand_id, campaign_id, email, event_type, created_by)
             VALUES ($1,$2,'—','campaign_cancelled',$3)`,
            [camp[0].brand_id, id, user.id]
          );
        } catch {}
        return res.status(200).json({ ok: true });
      }

      // ── Enviar campanha ──────────────────────────────
      if (action === 'send') {
        const camp = await query(
          `SELECT c.*
           FROM campaigns c
           JOIN user_brand_roles ubr ON ubr.brand_id = c.brand_id AND ubr.user_id = $2
           WHERE c.id=$1`, [id, user.id]
        );
        if (!camp[0]) return res.status(404).json({ error: 'Campanha não encontrada' });
        if (camp[0].status === 'sending')
          return res.status(409).json({ error: 'Campanha já está a ser enviada, aguarda…' });
        if (camp[0].status === 'sent')
          return res.status(409).json({ error: 'Campanha já foi enviada.' });

        // Contacts from lists
        const listContacts = await query(
          `SELECT DISTINCT c.id, c.email, c.name
           FROM contacts c
           JOIN list_members lm ON lm.contact_id=c.id
           JOIN campaign_lists cl ON cl.list_id=lm.list_id AND cl.campaign_id=$1
           WHERE c.brand_id=$2 AND c.status='active'
             AND c.email NOT IN (SELECT email FROM suppression)`,
          [id, camp[0].brand_id]
        );
        if (listContacts.length) {
          const vals = listContacts.map((_, i) => `($${i*3+1},$${i*3+2},$${i*3+3})`).join(',');
          await query(
            `INSERT INTO campaign_recipients (campaign_id,contact_id,email) VALUES ${vals} ON CONFLICT (campaign_id,contact_id) DO NOTHING`,
            listContacts.flatMap(ct => [id, ct.id, ct.email])
          );
        }

        // Count total pending (lists + direct imports)
        const [{ total }] = await query(
          `SELECT COUNT(*)::int AS total FROM campaign_recipients WHERE campaign_id=$1 AND status='pending'`,
          [id]
        );
        if (!total) return res.status(400).json({ error: 'Sem destinatários activos. Verifica se a campanha tem listas associadas ou contactos importados directamente.' });

        // CAN-SPAM: ensure physical address is set (use brand default if not configured)
        const DEFAULT_COMPANY_ADDRESS = 'Rua do Barreiro, 547 4409-513 Vila Nova de Gaia';
        const [brand] = await query(`SELECT variables FROM brands WHERE id=$1`, [camp[0].brand_id]);
        const brandVars = brand?.variables || {};
        if (!brandVars.company_address) {
          brandVars.company_address = DEFAULT_COMPANY_ADDRESS;
        }

        await query("UPDATE campaigns SET status='sending' WHERE id=$1", [id]);

        try {
          await query(
            `INSERT INTO email_send_log (brand_id, campaign_id, email, event_type, created_by)
             VALUES ($1,$2,$3,'campaign_started',$4)`,
            [camp[0].brand_id, id, `${total} destinatários`, user.id]
          );
        } catch (err) { if (err.code !== '42P01') console.error('send log start:', err); }

        return res.status(200).json({ ok: true, total, queued: true });
      }

      // ── Enviar batch (chamado repetidamente pelo frontend) ──────
      if (action === 'send_batch') {
        const camp = await query(
          `SELECT c.*, t.html_content,
                  b.from_name AS brand_from_name, b.from_email AS brand_from_email,
                  b.reply_to AS brand_reply_to, b.variables
           FROM campaigns c
           JOIN user_brand_roles ubr ON ubr.brand_id = c.brand_id AND ubr.user_id = $2
           LEFT JOIN templates t ON t.id=c.template_id
           LEFT JOIN brands b ON b.id=c.brand_id
           WHERE c.id=$1`, [id, user.id]
        );
        if (!camp[0]) return res.status(404).json({ error: 'Campanha não encontrada' });
        if (camp[0].status === 'sent')
          return res.status(200).json({ done: true, sent: 0, failed: 0, remaining: 0 });
        if (camp[0].status !== 'sending')
          return res.status(400).json({ error: `Campanha não está em envio (status: ${camp[0].status})` });

        const BATCH = parseInt(process.env.SES_BATCH_SIZE || '50', 10);
        // Pick up both fresh pending contacts and soft-bounce retries
        const pending = await query(
          `SELECT cr.contact_id, cr.email, con.name, cr.retry_count
           FROM campaign_recipients cr
           JOIN contacts con ON con.id = cr.contact_id
           WHERE cr.campaign_id = $1 AND cr.status IN ('pending','retry')
           ORDER BY cr.status DESC, cr.contact_id ASC
           LIMIT $2`,
          [id, BATCH]
        );

        if (!pending.length) {
          await query("UPDATE campaigns SET status='sent', sent_at=NOW() WHERE id=$1", [id]);
          return res.status(200).json({ done: true, sent: 0, failed: 0, remaining: 0 });
        }

        if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
          await query(
            "UPDATE campaign_recipients SET status='sent', sent_at=NOW() WHERE campaign_id=$1 AND status='pending'",
            [id]
          );
          await query("UPDATE campaigns SET status='sent', sent_at=NOW() WHERE id=$1", [id]);
          return res.status(200).json({ done: true, sent: pending.length, failed: 0, remaining: 0, warning: 'AWS SES não configurado' });
        }

        const c = camp[0];
        const sesClient = new SESClient({
          region: process.env.AWS_REGION || 'eu-west-1',
          credentials: {
            accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          },
        });

        const fromDomain = process.env.FROM_DOMAIN || 'caetano.pt';
        const appUrl     = process.env.APP_URL || 'https://email-marketing-eta.vercel.app';
        const fromName   = c.from_name  || c.brand_from_name  || 'PrimeMail';
        const fromEmail  = c.from_email || c.brand_from_email || `info@${fromDomain}`;
        const replyTo    = c.reply_to   || c.brand_reply_to   || undefined;

        const utmParams = c.utm_params || {};
        const utmStr = Object.entries(utmParams).filter(([, v]) => v)
          .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
        function injectUtm(html) {
          if (!utmStr) return html;
          return html.replace(/href="(https?:\/\/[^"]+)"/gi, (match, url) => {
            if (url.includes('action=unsubscribe') || url.includes('action=resubscribe')) return match;
            const sep = url.includes('?') ? '&' : '?';
            return `href="${url}${sep}${utmStr}"`;
          });
        }

        const RATE = parseInt(process.env.SES_RATE || '14', 10);
        let sent = 0, failed = 0;

        for (let i = 0; i < pending.length; i += RATE) {
          await Promise.all(pending.slice(i, i + RATE).map(async contact => {
            try {
              const token = unsubToken(contact.email, c.brand_id);
              const unsubUrl = `${appUrl}/api/suppression?brand_id=${c.brand_id}&action=unsubscribe&email=${encodeURIComponent(contact.email)}&token=${token}`;
              const unsubBlock = `<div style="text-align:center;padding:20px;font-family:sans-serif;font-size:11px;color:#999">
                <a href="${unsubUrl}" style="color:#999">Cancelar subscrição</a>
              </div>`;
              const DEFAULT_COMPANY_ADDRESS = 'Rua do Barreiro, 547 4409-513 Vila Nova de Gaia';
              const vars = { company_address: DEFAULT_COMPANY_ADDRESS, ...(c.variables || {}) };
              let rawHtml = (c.html_content||'')
                .replace(/\{\{name\}\}/g, contact.name||contact.email)
                .replace(/\{\{email\}\}/g, contact.email)
                .replace(/\{\{unsubscribe_url\}\}/g, unsubUrl);
              for (const [k, v] of Object.entries(vars)) {
                rawHtml = rawHtml.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v || '');
              }
              rawHtml = injectUtm(rawHtml);
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
                  { Name: 'campaign_id', Value: String(id) },
                  { Name: 'contact_id',  Value: String(contact.contact_id) },
                ],
              });
              const info = await sesClient.send(sesCmd);
              const msgId = info?.MessageId || null;
              try {
                await query(
                  "UPDATE campaign_recipients SET status='sent',message_id=$1,sent_at=NOW(),attempted_at=NOW(),error_message=NULL WHERE campaign_id=$2 AND contact_id=$3",
                  [msgId, id, contact.contact_id]
                );
              } catch (e1) {
                if (e1.code === '42703') {
                  await query(
                    "UPDATE campaign_recipients SET status='sent',message_id=$1,sent_at=NOW() WHERE campaign_id=$2 AND contact_id=$3",
                    [msgId, id, contact.contact_id]
                  );
                } else { throw e1; }
              }
              try {
                await query(
                  `INSERT INTO email_send_log (brand_id, campaign_id, contact_id, email, event_type, message_id, created_by)
                   VALUES ($1,$2,$3,$4,'sent',$5,$6)`,
                  [c.brand_id, id, contact.contact_id, contact.email, msgId, user.id]
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
                  [id, contact.contact_id, errMsg, newStatus]
                );
              } catch (e2) {
                if (e2.code === '42703') {
                  await query(
                    "UPDATE campaign_recipients SET status='failed' WHERE campaign_id=$1 AND contact_id=$2",
                    [id, contact.contact_id]
                  );
                } else { throw e2; }
              }
              try {
                await query(
                  `INSERT INTO email_send_log (brand_id, campaign_id, contact_id, email, event_type, error, created_by)
                   VALUES ($1,$2,$3,$4,'failed',$5,$6)`,
                  [c.brand_id, id, contact.contact_id, contact.email, errMsg, user.id]
                );
              } catch (err) { if (err.code !== '42P01') console.error('send log:', err); }
              failed++;
            }
          }));
          if (i + RATE < pending.length) await new Promise(r => setTimeout(r, 1000));
        }

        const [{ remaining }] = await query(
          "SELECT COUNT(*)::int AS remaining FROM campaign_recipients WHERE campaign_id=$1 AND status IN ('pending','retry')",
          [id]
        );

        if (remaining === 0) {
          await query("UPDATE campaigns SET status='sent', sent_at=NOW() WHERE id=$1", [id]);
          try {
            const [totals] = await query(
              `SELECT COUNT(*) FILTER (WHERE status='sent')::int AS total_sent,
                      COUNT(*) FILTER (WHERE status='failed')::int AS total_failed
               FROM campaign_recipients WHERE campaign_id=$1`, [id]
            );
            await query(
              `INSERT INTO email_send_log (brand_id, campaign_id, email, event_type, created_by)
               VALUES ($1,$2,$3,'campaign_completed',$4)`,
              [c.brand_id, id, `enviados=${totals.total_sent} falhados=${totals.total_failed}`, user.id]
            );
          } catch (err) { if (err.code !== '42P01') console.error('send log end:', err); }
        }

        return res.status(200).json({ ok: true, sent, failed, remaining, done: remaining === 0 });
      }


      // ── Email de teste ───────────────────────────────
      if (action === 'test') {
        const { to } = req.body || {};
        if (!to || !to.includes('@')) return res.status(400).json({ error: 'Email de destino inválido' });

        const camp = await query(
          `SELECT c.*, t.html_content,
                  b.from_name AS brand_from_name, b.from_email AS brand_from_email, b.reply_to AS brand_reply_to
           FROM campaigns c
           JOIN user_brand_roles ubr ON ubr.brand_id = c.brand_id AND ubr.user_id = $2
           LEFT JOIN templates t ON t.id=c.template_id
           LEFT JOIN brands b ON b.id=c.brand_id
           WHERE c.id=$1`, [id, user.id]
        );
        if (!camp[0]) return res.status(404).json({ error: 'Campanha não encontrada' });

        if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY)
          return res.status(400).json({ error: 'AWS SES não configurado' });

        const sesClientTest = new SESClient({
          region: process.env.AWS_REGION || 'eu-west-1',
          credentials: {
            accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          },
        });
        const c = camp[0];
        const appUrl = process.env.APP_URL || 'https://email-marketing-eta.vercel.app';
        const fromName  = c.from_name  || c.brand_from_name  || 'PrimeMail';
        const fromEmail = c.from_email || c.brand_from_email || `info@caetano.pt`;
        const replyTo   = c.reply_to   || c.brand_reply_to   || undefined;
        const unsubUrl = `${appUrl}#unsubscribe`;
        const unsubBlock = `<div style="text-align:center;padding:20px;font-family:sans-serif;font-size:11px;color:#999;border-top:1px solid #eee;margin-top:20px">
          <p style="margin:0 0 6px">⚠️ Este é um email de teste enviado pelo PrimeMail.</p>
          <a href="${unsubUrl}" style="color:#999">Cancelar subscrição</a>
        </div>`;
        const rawHtml = ('[TESTE] ' + (c.html_content||'<p>Sem conteúdo de template.</p>'))
          .replace(/\{\{name\}\}/g, 'Utilizador Teste')
          .replace(/\{\{email\}\}/g, to)
          .replace(/\{\{unsubscribe_url\}\}/g, unsubUrl);
        const finalHtml = rawHtml.includes('</body>')
          ? rawHtml.replace('</body>', unsubBlock + '</body>')
          : rawHtml + unsubBlock;
        try {
          const info = await sesClientTest.send(new SendEmailCommand({
            Source: `${fromName} <${fromEmail}>`,
            Destination: { ToAddresses: [to] },
            Message: {
              Subject: { Charset: 'UTF-8', Data: `[TESTE] ${c.subject || '(sem assunto)'}` },
              Body: {
                Html: { Charset: 'UTF-8', Data: finalHtml },
                Text: { Charset: 'UTF-8', Data: '[EMAIL DE TESTE]\n\n' + htmlToText(finalHtml) },
              },
            },
            ...(replyTo ? { ReplyToAddresses: [replyTo] } : {}),
          }));
          try {
            await query(
              `INSERT INTO email_send_log (brand_id, campaign_id, email, event_type, message_id, created_by)
               VALUES ($1,$2,$3,'test_sent',$4,$5)`,
              [c.brand_id, id, to, info?.MessageId||null, user.id]
            );
          } catch (e) { if (e.code !== '42P01') console.error('send log test:', e); }
          return res.status(200).json({ ok: true, messageId: info?.MessageId || null });
        } catch (err) {
          try {
            await query(
              `INSERT INTO email_send_log (brand_id, campaign_id, email, event_type, error, created_by)
               VALUES ($1,$2,$3,'test_failed',$4,$5)`,
              [c.brand_id, id, to, (err.message||'').slice(0, 500), user.id]
            );
          } catch (e) { if (e.code !== '42P01') console.error('send log test fail:', e); }
          return res.status(500).json({ error: 'Falha no envio SES', detail: err.message });
        }
      }

    }

    res.status(405).json({ error: 'Método não permitido' });
  } catch (err) {
    res.status(500).json({ error: 'Erro de servidor', detail: err.message });
  }
};
