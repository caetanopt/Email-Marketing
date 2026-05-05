const { query } = require('../../lib/db');
const { requireAuth, cors } = require('../../lib/auth');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

function unsubToken(email, brandId) {
  return crypto.createHmac('sha256', process.env.JWT_SECRET || 'secret')
    .update(`${email}:${brandId}`)
    .digest('hex');
}

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  const user = requireAuth(req, res);
  if (!user) return;

  const { id, action } = req.query;

  try {
    if (req.method === 'GET') {
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
      return res.status(200).json({ ...rows[0], lists });
    }

    if (req.method === 'PUT') {
      const { name, subject, preview_text, from_name, from_email,
              template_id, scheduled_at, status, list_ids } = req.body || {};
      await query(
        `UPDATE campaigns SET name=COALESCE($1,name), subject=$2, preview_text=$3,
         from_name=$4, from_email=$5, template_id=COALESCE($6,template_id),
         scheduled_at=$7, status=COALESCE($8,status), updated_at=NOW() WHERE id=$9`,
        [name||null, subject||null, preview_text||null, from_name||null, from_email||null,
         template_id||null, scheduled_at||null, status||null, id]
      );
      if (list_ids) {
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
      await query('DELETE FROM campaigns WHERE id=$1', [id]);
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'POST') {

      // ── Enviar campanha ──────────────────────────────
      if (action === 'send') {
        const camp = await query(
          `SELECT c.*, t.html_content FROM campaigns c
           LEFT JOIN templates t ON t.id=c.template_id WHERE c.id=$1`, [id]
        );
        if (!camp[0]) return res.status(404).json({ error: 'Campanha não encontrada' });
        if (!['draft','scheduled'].includes(camp[0].status))
          return res.status(400).json({ error: 'Campanha já enviada' });

        const contacts = await query(
          `SELECT DISTINCT c.id, c.email, c.name
           FROM contacts c
           JOIN list_members lm ON lm.contact_id=c.id
           JOIN campaign_lists cl ON cl.list_id=lm.list_id AND cl.campaign_id=$1
           WHERE c.brand_id=$2 AND c.status='active'
             AND c.email NOT IN (SELECT email FROM suppression WHERE brand_id=$2)`,
          [id, camp[0].brand_id]
        );
        if (!contacts.length) return res.status(400).json({ error: 'Sem destinatários activos' });

        await query("UPDATE campaigns SET status='sending' WHERE id=$1", [id]);

        if (contacts.length) {
          const vals = contacts.map((_, i) => `($${i*3+1},$${i*3+2},$${i*3+3})`).join(',');
          await query(
            `INSERT INTO campaign_recipients (campaign_id,contact_id,email) VALUES ${vals} ON CONFLICT DO NOTHING`,
            contacts.flatMap(c => [id, c.id, c.email])
          );
        }

        if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
          await query("UPDATE campaigns SET status='sent', sent_at=NOW() WHERE id=$1", [id]);
          return res.status(200).json({ ok: true, sent: contacts.length, warning: 'SMTP não configurado — emails não enviados' });
        }

        const port = parseInt(process.env.SMTP_PORT || '587', 10);
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port,
          secure: port === 465, // true para 465 (SSL), false para 587 (STARTTLS)
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          },
        });
        const c = camp[0];
        const fromDomain = process.env.SMTP_FROM_DOMAIN || 'caetano.pt';
        const appUrl = process.env.APP_URL || 'https://email-marketing-eta.vercel.app';
        let sent = 0, failed = 0;

        // SES default rate limit is 14/sec for new accounts. Adjust via SMTP_RATE.
        const RATE = parseInt(process.env.SMTP_RATE || '14', 10);
        for (let i = 0; i < contacts.length; i += RATE) {
          await Promise.all(contacts.slice(i, i + RATE).map(async contact => {
            try {
              const token = unsubToken(contact.email, c.brand_id);
              const unsubUrl = `${appUrl}/api/suppression?brand_id=${c.brand_id}&action=unsubscribe&email=${encodeURIComponent(contact.email)}&token=${token}`;
              const unsubBlock = `<div style="text-align:center;padding:20px;font-family:sans-serif;font-size:11px;color:#999">
                <a href="${unsubUrl}" style="color:#999">Cancelar subscrição</a>
              </div>`;
              const rawHtml = (c.html_content||'')
                .replace(/\{\{name\}\}/g, contact.name||contact.email)
                .replace(/\{\{email\}\}/g, contact.email)
                .replace(/\{\{unsubscribe_url\}\}/g, unsubUrl);
              const finalHtml = rawHtml.includes('</body>')
                ? rawHtml.replace('</body>', unsubBlock + '</body>')
                : rawHtml + unsubBlock;
              const info = await transporter.sendMail({
                from: `${c.from_name||'PrimeMail'} <${c.from_email||`newsletter@${fromDomain}`}>`,
                to: contact.email,
                subject: c.subject || '(sem assunto)',
                replyTo: c.reply_to || undefined,
                html: finalHtml,
                headers: {
                  'X-Campaign-Id': String(id),
                  'X-Contact-Id':  String(contact.id),
                  'List-Unsubscribe': `<${unsubUrl}>`,
                  'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
                },
              });
              await query(
                "UPDATE campaign_recipients SET status='sent',message_id=$1,sent_at=NOW() WHERE campaign_id=$2 AND contact_id=$3",
                [info?.messageId||null, id, contact.id]
              );
              sent++;
            } catch (err) {
              console.error('SMTP send error:', err?.message);
              await query(
                "UPDATE campaign_recipients SET status='failed' WHERE campaign_id=$1 AND contact_id=$2",
                [id, contact.id]
              );
              failed++;
            }
          }));
          // Throttle to respect rate limit (1 second per batch)
          if (i + RATE < contacts.length) await new Promise(r => setTimeout(r, 1000));
        }

        transporter.close();
        await query("UPDATE campaigns SET status='sent', sent_at=NOW() WHERE id=$1", [id]);
        return res.status(200).json({ ok: true, sent, failed, total: contacts.length });
      }

      // ── Relatório ────────────────────────────────────
      if (action === 'report') {
        const camp = await query('SELECT * FROM campaigns WHERE id=$1', [id]);
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
        });
      }
    }

    res.status(405).json({ error: 'Método não permitido' });
  } catch (err) {
    res.status(500).json({ error: 'Erro de servidor', detail: err.message });
  }
};
