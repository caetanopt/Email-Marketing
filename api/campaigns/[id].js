const { getPool } = require('../../lib/db');
const { requireAuth, cors } = require('../../lib/auth');
const { Resend } = require('resend');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  const user = requireAuth(req, res);
  if (!user) return;

  const { id, action } = req.query;
  const db = getPool();

  // GET — detalhes da campanha
  if (req.method === 'GET') {
    const [[campaign]] = await db.query(
      `SELECT c.*, t.html_content, t.name AS template_name
       FROM campaigns c LEFT JOIN templates t ON t.id = c.template_id
       WHERE c.id = ?`, [id]
    );
    if (!campaign) return res.status(404).json({ error: 'Campanha não encontrada' });

    const [lists] = await db.query(
      `SELECT l.id, l.name, COUNT(lm.contact_id) AS total
       FROM campaign_lists cl JOIN lists l ON l.id = cl.list_id
       LEFT JOIN list_members lm ON lm.list_id = l.id
       WHERE cl.campaign_id = ? GROUP BY l.id`, [id]
    );

    return res.status(200).json({ ...campaign, lists });
  }

  // PUT — editar campanha
  if (req.method === 'PUT') {
    const { name, subject, preview_text, from_name, from_email,
            template_id, scheduled_at, status, list_ids } = req.body || {};

    await db.query(
      `UPDATE campaigns SET name=COALESCE(?,name), subject=?, preview_text=?, from_name=?,
       from_email=?, template_id=COALESCE(?,template_id),
       scheduled_at=?, status=COALESCE(?,status) WHERE id=?`,
      [name||null, subject||null, preview_text||null, from_name||null,
       from_email||null, template_id||null, scheduled_at||null, status||null, id]
    );

    if (list_ids) {
      await db.query('DELETE FROM campaign_lists WHERE campaign_id=?', [id]);
      if (list_ids.length) {
        await db.query(
          'INSERT INTO campaign_lists (campaign_id, list_id) VALUES ' + list_ids.map(() => '(?,?)').join(','),
          list_ids.flatMap(lid => [id, lid])
        );
      }
    }
    return res.status(200).json({ ok: true });
  }

  // DELETE
  if (req.method === 'DELETE') {
    await db.query('DELETE FROM campaigns WHERE id=?', [id]);
    return res.status(200).json({ ok: true });
  }

  // POST — ações: send, report
  if (req.method === 'POST') {

    // ── Enviar campanha ──────────────────────────────
    if (action === 'send') {
      const [[campaign]] = await db.query(
        `SELECT c.*, t.html_content, t.subject AS tpl_subject
         FROM campaigns c LEFT JOIN templates t ON t.id = c.template_id
         WHERE c.id = ?`, [id]
      );
      if (!campaign) return res.status(404).json({ error: 'Campanha não encontrada' });
      if (!['draft','scheduled'].includes(campaign.status))
        return res.status(400).json({ error: 'Campanha já enviada ou em envio' });

      // Buscar contactos activos das listas desta campanha (sem suprimidos)
      const [contacts] = await db.query(
        `SELECT DISTINCT c.id, c.email, c.name
         FROM contacts c
         JOIN list_members lm ON lm.contact_id = c.id
         JOIN campaign_lists cl ON cl.list_id = lm.list_id AND cl.campaign_id = ?
         WHERE c.brand_id = ? AND c.status = 'active'
           AND c.email NOT IN (
             SELECT email FROM suppression WHERE brand_id = ?
           )`,
        [id, campaign.brand_id, campaign.brand_id]
      );

      if (!contacts.length) return res.status(400).json({ error: 'Sem destinatários activos' });

      // Marcar como a enviar
      await db.query('UPDATE campaigns SET status=? WHERE id=?', ['sending', id]);

      // Inserir registo de destinatários
      await db.query(
        'INSERT IGNORE INTO campaign_recipients (campaign_id, contact_id, email) VALUES ' +
        contacts.map(() => '(?,?,?)').join(','),
        contacts.flatMap(c => [id, c.id, c.email])
      );

      if (!process.env.RESEND_API_KEY) {
        await db.query("UPDATE campaigns SET status='sent', sent_at=NOW() WHERE id=?", [id]);
        return res.status(200).json({
          ok: true,
          sent: contacts.length,
          warning: 'RESEND_API_KEY não configurado — emails não enviados'
        });
      }

      const resend = new Resend(process.env.RESEND_API_KEY);
      const fromDomain = process.env.RESEND_FROM_DOMAIN || 'caetano.link';
      const fromEmail = campaign.from_email || `newsletter@${fromDomain}`;
      const fromName  = campaign.from_name  || 'PrimeMail';
      const subject   = campaign.subject    || campaign.tpl_subject || '(sem assunto)';
      const html      = campaign.html_content || '<p>Email sem conteúdo.</p>';

      let sent = 0, failed = 0;

      // Envio em lotes de 50 (limite do plano free do Resend)
      const BATCH = 50;
      for (let i = 0; i < contacts.length; i += BATCH) {
        const batch = contacts.slice(i, i + BATCH);
        await Promise.all(batch.map(async contact => {
          try {
            const { data } = await resend.emails.send({
              from: `${fromName} <${fromEmail}>`,
              to: contact.email,
              subject,
              html: html.replace(/\{\{name\}\}/g, contact.name || contact.email),
            });
            await db.query(
              "UPDATE campaign_recipients SET status='sent', message_id=?, sent_at=NOW() WHERE campaign_id=? AND contact_id=?",
              [data?.id || null, id, contact.id]
            );
            sent++;
          } catch {
            await db.query(
              "UPDATE campaign_recipients SET status='failed' WHERE campaign_id=? AND contact_id=?",
              [id, contact.id]
            );
            failed++;
          }
        }));
      }

      await db.query("UPDATE campaigns SET status='sent', sent_at=NOW() WHERE id=?", [id]);
      return res.status(200).json({ ok: true, sent, failed, total: contacts.length });
    }

    // ── Relatório ────────────────────────────────────
    if (action === 'report') {
      const [[campaign]] = await db.query('SELECT * FROM campaigns WHERE id=?', [id]);
      if (!campaign) return res.status(404).json({ error: 'Campanha não encontrada' });

      const [[counts]] = await db.query(
        `SELECT
          COUNT(*) AS total,
          SUM(status='sent') AS sent,
          SUM(status='failed') AS failed,
          SUM(status='bounced') AS bounced,
          SUM(status='suppressed') AS suppressed
         FROM campaign_recipients WHERE campaign_id=?`, [id]
      );

      const [[opens]] = await db.query(
        "SELECT COUNT(*) AS total, COUNT(DISTINCT contact_id) AS unique_count FROM email_events WHERE campaign_id=? AND type='open'", [id]
      );
      const [[clicks]] = await db.query(
        "SELECT COUNT(*) AS total, COUNT(DISTINCT contact_id) AS unique_count FROM email_events WHERE campaign_id=? AND type='click'", [id]
      );
      const [[unsubs]] = await db.query(
        "SELECT COUNT(*) AS total FROM email_events WHERE campaign_id=? AND type='unsubscribe'", [id]
      );
      const [[spam]] = await db.query(
        "SELECT COUNT(*) AS total FROM email_events WHERE campaign_id=? AND type='spam'", [id]
      );

      const [topLinks] = await db.query(
        `SELECT url, COUNT(*) AS clicks, COUNT(DISTINCT contact_id) AS unique_clicks
         FROM email_events WHERE campaign_id=? AND type='click' AND url IS NOT NULL
         GROUP BY url ORDER BY clicks DESC LIMIT 10`, [id]
      );

      const delivered = parseInt(counts.sent) || 0;
      const openUniq  = parseInt(opens.unique_count) || 0;
      const clickUniq = parseInt(clicks.unique_count) || 0;

      return res.status(200).json({
        campaign,
        delivery: {
          total:       parseInt(counts.total)      || 0,
          sent:        delivered,
          failed:      parseInt(counts.failed)     || 0,
          bounced:     parseInt(counts.bounced)    || 0,
          suppressed:  parseInt(counts.suppressed) || 0,
          delivery_rate: delivered ? ((delivered / parseInt(counts.total)) * 100).toFixed(1) : 0,
        },
        engagement: {
          opens:       parseInt(opens.total)  || 0,
          unique_opens: openUniq,
          clicks:      parseInt(clicks.total) || 0,
          unique_clicks: clickUniq,
          open_rate:   delivered ? ((openUniq  / delivered) * 100).toFixed(1) : 0,
          click_rate:  delivered ? ((clickUniq / delivered) * 100).toFixed(1) : 0,
          ctor:        openUniq  ? ((clickUniq / openUniq)  * 100).toFixed(1) : 0,
          unsubscribes: parseInt(unsubs.total) || 0,
          spam_complaints: parseInt(spam.total) || 0,
        },
        top_links: topLinks,
      });
    }
  }

  res.status(405).json({ error: 'Método não permitido' });
};
