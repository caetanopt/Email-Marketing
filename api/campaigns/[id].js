const { query } = require('../../lib/db');
const { requireAuth, cors } = require('../../lib/auth');
const { getSESClient } = require('../../lib/ses');
const { SendEmailCommand, SendRawEmailCommand, GetSendQuotaCommand } = require('@aws-sdk/client-ses');
const crypto = require('crypto');
const { initCampaignSend, runBatch } = require('../../lib/sendCampaign');

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
      const [{ total }] = await query(
        `SELECT COUNT(*)::int AS total FROM campaign_recipients WHERE campaign_id=$1`, [id]
      );
      const recs = await query(
        `SELECT cr.email, c.name AS contact_name
         FROM campaign_recipients cr
         LEFT JOIN contacts c ON c.id = cr.contact_id
         WHERE cr.campaign_id = $1
         ORDER BY cr.id DESC LIMIT 100`,
        [id]
      );
      return res.status(200).json({ recipients: recs, total });
    }

    if (req.method === 'DELETE' && action === 'remove_direct_recipients') {
      if (camp.status === 'sent') return res.status(409).json({ error: 'Não é possível modificar uma campanha já enviada.' });
      await query(`DELETE FROM campaign_recipients WHERE campaign_id=$1`, [id]);
      return res.status(200).json({ ok: true });
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
        // Conta apenas eventos de destinatários efectivamente entregues
        // (status='sent'), para que a população do numerador seja sempre um
        // subconjunto do denominador — evita taxas acima de 100%.
        const [opens] = await query(
          `SELECT COUNT(DISTINCT ee.contact_id)::int AS total, COUNT(DISTINCT ee.contact_id)::int AS unique_count
           FROM email_events ee
           JOIN campaign_recipients cr ON cr.campaign_id=ee.campaign_id AND cr.contact_id=ee.contact_id AND cr.status='sent'
           WHERE ee.campaign_id=$1 AND ee.type='open'`, [id]
        );
        const [clicks] = await query(
          `SELECT COUNT(DISTINCT ee.contact_id)::int AS total, COUNT(DISTINCT ee.contact_id)::int AS unique_count
           FROM email_events ee
           JOIN campaign_recipients cr ON cr.campaign_id=ee.campaign_id AND cr.contact_id=ee.contact_id AND cr.status='sent'
           WHERE ee.campaign_id=$1 AND ee.type='click'`, [id]
        );
        const [unsubs] = await query(
          "SELECT COUNT(DISTINCT contact_id)::int AS total FROM email_events WHERE campaign_id=$1 AND type='unsubscribe'", [id]
        );
        const [spam] = await query(
          "SELECT COUNT(DISTINCT contact_id)::int AS total FROM email_events WHERE campaign_id=$1 AND type='spam'", [id]
        );
        const top_links = await query(
          `SELECT ee.url, COUNT(DISTINCT ee.contact_id)::int AS clicks, COUNT(DISTINCT ee.contact_id)::int AS unique_clicks
           FROM email_events ee
           JOIN campaign_recipients cr ON cr.campaign_id=ee.campaign_id AND cr.contact_id=ee.contact_id AND cr.status='sent'
           WHERE ee.campaign_id=$1 AND ee.type='click' AND ee.url IS NOT NULL
           GROUP BY ee.url ORDER BY clicks DESC LIMIT 10`, [id]
        );
        const timeseries = await query(
          `SELECT date_trunc('hour', created_at) AS bucket,
                  COUNT(DISTINCT contact_id) FILTER (WHERE type='open')::int AS opens,
                  COUNT(DISTINCT contact_id) FILTER (WHERE type='click')::int AS clicks
           FROM email_events
           WHERE campaign_id=$1 AND type IN ('open','click')
           GROUP BY bucket ORDER BY bucket LIMIT 168`, [id]
        );
        const segments = await query(
          `WITH cr_list AS (
             SELECT DISTINCT lm.list_id, cr.contact_id
             FROM campaign_recipients cr
             JOIN list_members lm ON lm.contact_id = cr.contact_id
             JOIN campaign_lists cl ON cl.list_id = lm.list_id AND cl.campaign_id = cr.campaign_id
             WHERE cr.campaign_id = $1 AND cr.status = 'sent'
           ),
           ee_agg AS (
             SELECT contact_id,
                    bool_or(type = 'open')  AS opened,
                    bool_or(type = 'click') AS clicked
             FROM email_events
             WHERE campaign_id = $1 AND type IN ('open', 'click')
             GROUP BY contact_id
           )
           SELECT l.id, l.name,
                  COUNT(DISTINCT cl2.contact_id)::int AS sent,
                  COUNT(DISTINCT CASE WHEN ea.opened  THEN cl2.contact_id END)::int AS opens,
                  COUNT(DISTINCT CASE WHEN ea.clicked THEN cl2.contact_id END)::int AS clicks
           FROM campaign_lists cl_base
           JOIN lists l ON l.id = cl_base.list_id
           LEFT JOIN cr_list cl2 ON cl2.list_id = cl_base.list_id
           LEFT JOIN ee_agg ea ON ea.contact_id = cl2.contact_id
           WHERE cl_base.campaign_id = $1
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
                  COALESCE(rc.sent,0)  AS sent,
                  COALESCE(rc.total,0) AS total_recipients,
                  COALESCE(ev.unique_opens,0)  AS unique_opens,
                  COALESCE(ev.unique_clicks,0) AS unique_clicks,
                  COALESCE(ev.unsubs,0) AS unsubs
           FROM last_camps lc
           LEFT JOIN LATERAL (
             SELECT COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE cr.status='sent')::int AS sent
             FROM campaign_recipients cr WHERE cr.campaign_id = lc.id
           ) rc ON TRUE
           LEFT JOIN LATERAL (
             SELECT COUNT(DISTINCT ee.contact_id) FILTER (WHERE ee.type='open')::int  AS unique_opens,
                    COUNT(DISTINCT ee.contact_id) FILTER (WHERE ee.type='click')::int AS unique_clicks,
                    COUNT(DISTINCT ee.contact_id) FILTER (WHERE ee.type='unsubscribe')::int AS unsubs
             FROM email_events ee WHERE ee.campaign_id = lc.id
           ) ev ON TRUE
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
              template_id, scheduled_at, status, list_ids, utm_params, attachments } = req.body || {};
      await query(
        `UPDATE campaigns SET name=COALESCE($1,name), subject=$2, preview_text=$3,
         from_name=$4, from_email=$5, template_id=COALESCE($6,template_id),
         scheduled_at=$7, status=COALESCE($8,status),
         utm_params=COALESCE($9,utm_params),
         attachments=COALESCE($10,attachments),
         updated_at=NOW() WHERE id=$11 AND brand_id=$12`,
        [name||null, subject||null, preview_text||null, from_name||null, from_email||null,
         template_id||null, scheduled_at||null, status||null,
         utm_params != null ? JSON.stringify(utm_params) : null,
         attachments != null ? JSON.stringify(attachments) : null,
         id, camp.brand_id]
      );
      if (list_ids) {
        if (list_ids.length) {
          // Listas globais: basta o utilizador pertencer a alguma marca
          const accessible = await query(
            `SELECT l.id FROM lists l
             WHERE l.id = ANY($1::int[])
               AND EXISTS (SELECT 1 FROM user_brand_roles WHERE user_id = $2)`,
            [list_ids, user.id]
          );
          if (accessible.length !== list_ids.length) return res.status(400).json({ error: 'Uma ou mais listas não são acessíveis' });
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
        const { contact_ids, temp_contact_ids = [] } = req.body || {};
        if (!Array.isArray(contact_ids) || !contact_ids.length)
          return res.status(400).json({ error: 'contact_ids obrigatório' });
        await query(`ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS is_temp BOOLEAN DEFAULT false`);
        const tempSet = new Set((temp_contact_ids || []).map(Number));
        const contacts = await query(
          `SELECT id, email FROM contacts
           WHERE id = ANY($1::int[]) AND brand_id=$2
             AND status NOT IN ('suppressed','bounced','unsubscribed','complained')
             AND lower(email) NOT IN (SELECT lower(email) FROM suppression WHERE email NOT LIKE '@%')
             AND '@'||split_part(lower(email),'@',2) NOT IN (SELECT lower(email) FROM suppression WHERE email LIKE '@%')`,
          [contact_ids, camp.brand_id]
        );
        if (!contacts.length) return res.status(200).json({ ok: true, added: 0 });
        const vals = contacts.map((_, i) => `($${i*4+1},$${i*4+2},$${i*4+3},'pending',$${i*4+4})`).join(',');
        await query(
          `INSERT INTO campaign_recipients (campaign_id,contact_id,email,status,is_temp) VALUES ${vals} ON CONFLICT (campaign_id,contact_id) DO NOTHING`,
          contacts.flatMap(ct => [id, ct.id, ct.email, tempSet.has(Number(ct.id))])
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
        // Atomic: only cancel if still sending/scheduled — if the last batch
        // finished meanwhile and marked the campaign 'sent', don't clobber it.
        const cancelled = await query(
          `UPDATE campaigns SET status='draft', sent_at=NULL
           WHERE id=$1 AND status IN ('sending','scheduled') RETURNING id`, [id]
        );
        if (!cancelled[0])
          return res.status(409).json({ error: 'A campanha terminou entretanto — não foi cancelada.' });
        // Reset retry recipients to pending so a later resend starts fresh.
        try {
          await query(
            `UPDATE campaign_recipients SET status='pending', error_message=NULL
             WHERE campaign_id=$1 AND status='retry'`, [id]
          );
        } catch (e) {
          if (e.code === '42703') {
            await query(
              `UPDATE campaign_recipients SET status='pending'
               WHERE campaign_id=$1 AND status='retry'`, [id]
            );
          } else { throw e; }
        }
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
        const campCheck = await query(
          `SELECT c.id FROM campaigns c JOIN user_brand_roles ubr ON ubr.brand_id = c.brand_id AND ubr.user_id = $2 WHERE c.id=$1`,
          [id, user.id]
        );
        if (!campCheck[0]) return res.status(404).json({ error: 'Campanha não encontrada' });
        try {
          const { total, campaign: c2 } = await initCampaignSend(id);
          // log campaign_started with user
          try {
            await query(
              `INSERT INTO email_send_log (brand_id, campaign_id, email, event_type, created_by) VALUES ($1,$2,$3,'campaign_started',$4)`,
              [c2.brand_id, id, `${total} destinatários`, user.id]
            );
          } catch (err) { if (err.code !== '42P01') console.error('send log start:', err); }
          return res.status(200).json({ ok: true, total, queued: true });
        } catch (err) {
          if (err.message === 'Sem destinatários activos') return res.status(400).json({ error: err.message });
          if (err.code === 'already_sending') return res.status(200).json({ ok: true, total: 0, queued: true, already_sending: true });
          throw err;
        }
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
            [id]
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
              [id]
            );
          } else { throw e; }
        }

        const BATCH = parseInt(process.env.SES_BATCH_SIZE || '50', 10);
        // Claim atomically — see sendCampaign.js runBatch for the full rationale.
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
            [id, BATCH]
          );
        } catch (e) {
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
            [id, BATCH]
          );
        }
        const pending = claimedRows;

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
        const sesClient = getSESClient();

        // Pre-flight quota check — same logic as runBatch in sendCampaign.js
        let quotaRemaining = Infinity;
        try {
          const quotaInfo = await sesClient.send(new GetSendQuotaCommand({}));
          quotaRemaining = Math.max(0, Math.floor(quotaInfo.Max24HourSend - quotaInfo.SentLast24Hours));
          if (quotaRemaining < 1) {
            const [{ remaining }] = await query(
              "SELECT COUNT(*)::int AS remaining FROM campaign_recipients WHERE campaign_id=$1 AND status IN ('pending','retry')",
              [id]
            );
            return res.status(200).json({ done: false, sent: 0, failed: 0, remaining, quotaExhausted: true });
          }
        } catch (e) {
          console.warn('send_batch: quota pre-check failed, proceeding:', e.message);
        }

        const toSend = quotaRemaining < pending.length ? pending.slice(0, quotaRemaining) : pending;

        const fromName   = c.from_name  || c.brand_from_name  || 'eMKT';
        const fromEmail  = c.from_email || c.brand_from_email || `info@${FROM_DOMAIN}`;
        const replyTo    = c.reply_to   || c.brand_reply_to   || undefined;

        const utmParams = c.utm_params || {};
        const utmStr = Object.entries(utmParams).filter(([, v]) => v)
          .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

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
        const batchState = { quotaHit: false };

        for (let i = 0; i < toSend.length; i += RATE) {
          if (batchState.quotaHit) break;
          await Promise.all(toSend.slice(i, i + RATE).map(async contact => {
            if (batchState.quotaHit) return;
            try {
              const token = unsubToken(contact.email, c.brand_id);
              const unsubUrl = `${APP_URL}/api/suppression?brand_id=${c.brand_id}&action=unsubscribe&c=${id}&email=${encodeURIComponent(contact.email)}&token=${token}`;
              const trackTok = trackToken(id, contact.contact_id);
              const pixelUrl = `${APP_URL}/api/track?type=open&cid=${id}&uid=${contact.contact_id}&t=${trackTok}`;
              const unsubBlock = `<div style="text-align:center;padding:20px;font-family:sans-serif;font-size:11px;color:#999">
                <a href="${unsubUrl}" style="color:#999">Cancelar subscrição</a>
              </div><img src="${pixelUrl}" width="1" height="1" border="0" style="display:block;width:1px;height:1px;border:0" alt="" />`;
              const vars = { company_address: DEFAULT_COMPANY_ADDRESS, ...(c.variables || {}) };
              // Guard: if html_content is MJML (legacy), log a warning — template needs re-saving
              const rawContent = c.html_content || '';
              if (rawContent.trimStart().startsWith('<mjml>')) {
                console.warn(`Campaign ${id}: template stored as MJML — re-save to convert to HTML.`);
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
              rawHtml = injectTracking(rawHtml, id, contact.contact_id);
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
                    { Name: 'campaign_id', Value: String(id) },
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
                    { Name: 'campaign_id', Value: String(id) },
                    { Name: 'contact_id',  Value: String(contact.contact_id) },
                  ],
                });
                const info = await sesClient.send(sesCmd);
                msgId = info?.MessageId || null;
              }
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
              const isQuotaError = /Daily message quota exceeded|quota.*exceeded|DailyQuota/i.test(errMsg)
                || err?.name === 'LimitExceededException';
              if (isQuotaError) {
                batchState.quotaHit = true;
                return; // leave recipient as 'pending'
              }
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
          if (batchState.quotaHit) break;
          if (i + RATE < toSend.length) await new Promise(r => setTimeout(r, 1000));
        }

        const [{ remaining }] = await query(
          "SELECT COUNT(*)::int AS remaining FROM campaign_recipients WHERE campaign_id=$1 AND status IN ('pending','retry')",
          [id]
        );

        if (remaining === 0) {
          await query("UPDATE campaigns SET status='sent', sent_at=NOW() WHERE id=$1", [id]);
          try {
            await query(
              `DELETE FROM contacts
               WHERE id IN (
                 SELECT cr.contact_id FROM campaign_recipients cr
                 WHERE cr.campaign_id = $1 AND cr.is_temp = true
                   AND NOT EXISTS (SELECT 1 FROM list_members lm WHERE lm.contact_id = cr.contact_id)
               )`,
              [id]
            );
          } catch (e) { if (e.code !== '42703') console.error('temp contact cleanup:', e); }
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

        if (batchState.quotaHit) {
          return res.status(200).json({ ok: true, sent, failed, remaining, done: false, quotaExhausted: true });
        }
        return res.status(200).json({ ok: true, sent, failed, remaining, done: remaining === 0 });
      }


      // ── Email de teste ───────────────────────────────
      if (action === 'test') {
        const { to } = req.body || {};
        if (!to || !to.includes('@')) return res.status(400).json({ error: 'Email de destino inválido' });

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

        if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY)
          return res.status(400).json({ error: 'AWS SES não configurado' });

        const sesClientTest = getSESClient();
        const c = camp[0];
        const fromName  = c.from_name  || c.brand_from_name  || 'eMKT';
        const fromEmail = c.from_email || c.brand_from_email || `info@${FROM_DOMAIN}`;
        const replyTo   = c.reply_to   || c.brand_reply_to   || undefined;
        const unsubUrl = `${APP_URL}#unsubscribe`;
        const unsubBlock = `<div style="text-align:center;padding:20px;font-family:sans-serif;font-size:11px;color:#999;border-top:1px solid #eee;margin-top:20px">
          <p style="margin:0 0 6px">⚠️ Este é um email de teste enviado pelo eMKT.</p>
          <a href="${unsubUrl}" style="color:#999">Cancelar subscrição</a>
        </div>`;
        // Apply UTM params + click tracking (same as real sends so test reflects exact behaviour)
        const utmParamsT = c.utm_params || {};
        const utmStrT = Object.entries(utmParamsT).filter(([, v]) => v)
          .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
        function injectTrackingTest(html) {
          return html.replace(/href="(https?:\/\/[^"]+)"/gi, (match, rawUrl) => {
            const url = rawUrl.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
            if (url.includes('action=unsubscribe') || url.includes('action=resubscribe') || url.includes('/api/track?')) return match;
            let dest = url;
            if (utmStrT) { const sep = dest.includes('?') ? '&' : '?'; dest = `${dest}${sep}${utmStrT}`; }
            const redirect = `${APP_URL}/api/track?type=click&cid=${id}&uid=0&t=test&url=${encodeURIComponent(dest)}`;
            return `href="${redirect}"`;
          });
        }
        const testVars = { company_address: DEFAULT_COMPANY_ADDRESS, ...(c.variables || {}) };
        let rawHtml = (c.html_content || '<p style="font-family:sans-serif;color:#334155">Sem conteúdo de template.</p>');
        // Apply brand variables first (use function replacer to avoid $& interpolation issues)
        for (const [k, v] of Object.entries(testVars)) {
          const safeK = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          rawHtml = rawHtml.replace(new RegExp(`\\{\\{${safeK}\\}\\}`, 'g'), () => escHtml(v || ''));
        }
        rawHtml = rawHtml
          .replace(/\{\{name\}\}/g, () => 'Utilizador Teste')
          .replace(/\{\{email\}\}/g, () => escHtml(to))
          .replace(/\{\{phone\}\}/g, () => '')
          .replace(/\{\{company\}\}/g, () => '')
          .replace(/\{\{unsubscribe_url\}\}/g, () => unsubUrl);
        rawHtml = injectTrackingTest(rawHtml);
        const finalHtml = rawHtml.includes('</body>')
          ? rawHtml.replace('</body>', unsubBlock + '</body>')
          : rawHtml + unsubBlock;
        const testAttachments = c.attachments || [];
        try {
          let info;
          if (testAttachments.length > 0) {
            const rawMsg = buildRawEmail({
              fromName, fromEmail, toEmail: to, replyTo,
              subject: `[TESTE] ${c.subject || '(sem assunto)'}`,
              htmlBody: finalHtml,
              textBody: '[EMAIL DE TESTE]\n\n' + htmlToText(finalHtml),
              attachments: testAttachments,
            });
            info = await sesClientTest.send(new SendRawEmailCommand({
              RawMessage: { Data: Buffer.from(rawMsg) },
            }));
          } else {
            info = await sesClientTest.send(new SendEmailCommand({
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
          }
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
          return res.status(500).json({ error: 'Falha no envio SES' });
        }
      }

    }

    res.status(405).json({ error: 'Método não permitido' });
  } catch (err) {
    res.status(500).json({ error: 'Erro de servidor' });
  }
};
