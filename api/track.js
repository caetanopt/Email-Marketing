const { query, transaction } = require('../lib/db');
const { buildLegalFooter } = require('../lib/emailFooter');
const APP_URL_PREVIEW = (process.env.APP_URL || 'https://emkt.caetano.pt').replace(/\/$/, '');
const crypto = require('crypto');

const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

function trackToken(campaignId, contactId) {
  return crypto.createHmac('sha256', process.env.JWT_SECRET)
    .update(`track:${campaignId}:${contactId}`)
    .digest('hex');
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
              // Only re-queue rows not yet delivered (status='retry'). Rows already
              // recorded as 'sent' were accepted by SES; re-queuing them would send
              // a duplicate. For those, just log the bounce without changing status.
              const retryRows = await q(
                `UPDATE campaign_recipients
                 SET retry_count = COALESCE(retry_count, 0) + 1,
                     error_message = $2,
                     status = CASE WHEN COALESCE(retry_count, 0) >= 2 THEN 'failed' ELSE 'retry' END
                 WHERE email=$1 AND status = 'retry'
                 RETURNING campaign_id, contact_id`,
                [email, r.diagnosticCode || 'Soft bounce']
              );
              const sentRows = await q(
                `UPDATE campaign_recipients SET error_message=$2
                 WHERE email=$1 AND status = 'sent'
                 RETURNING campaign_id, contact_id`,
                [email, r.diagnosticCode || 'Soft bounce']
              );
              eventRows.push(...retryRows, ...sentRows);
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

  const { type, cid, uid, t, url, action, id, token } = req.query;

  // ── Public campaign preview (/api/preview rewrites here) ─────────
  if (action === 'preview') {
    function errPage(msg) {
      return `<!DOCTYPE html><html lang="pt"><head><meta charset="UTF-8"><title>Erro — PrimeMail</title>
<style>body{font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;background:#f1f5f9;color:#334155;gap:8px}
p{font-size:15px}small{color:#94a3b8;font-size:12px}</style></head>
<body><p>${msg}</p><small>PrimeMail</small></body></html>`;
    }
    function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

    if (!id || !token) return res.status(400).send(errPage('Link inválido.'));
    if (!process.env.JWT_SECRET) return res.status(500).send(errPage('Configuração em falta.'));

    const expected = crypto.createHmac('sha256', process.env.JWT_SECRET).update(`preview:${id}`).digest('hex');
    let tokOk = false;
    try { tokOk = crypto.timingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(expected, 'hex')); } catch (_) {}
    if (!tokOk) return res.status(403).send(errPage('Link inválido ou sem permissão.'));

    try {
      const rows = await query(
        `SELECT c.name, c.subject, b.name AS brand_name, b.logo_url AS brand_logo,
                b.variables AS brand_variables, t.html_content
         FROM campaigns c
         LEFT JOIN templates t ON t.id = c.template_id
         LEFT JOIN brands b ON b.id = c.brand_id
         WHERE c.id = $1`, [id]
      );
      if (!rows[0]) return res.status(404).send(errPage('Campanha não encontrada.'));
      const c = rows[0];
      if (!c.html_content) return res.status(404).send(errPage('Esta campanha não tem um template de email associado.'));

      // O rodapé legal é acrescentado em tempo de envio, não está gravado no
      // template — por isso tem de ser montado aqui também, senão a
      // pré-visualização mostrava o email sem ele.
      let footerCfg = {};
      try {
        const gs = await query('SELECT disclaimer, footer_logo_url, footer_socials FROM global_settings WHERE id=1');
        footerCfg = gs[0] || {};
      } catch (_) {}
      const rodape = buildLegalFooter({
        globalDisclaimer: footerCfg.disclaimer,
        footerLogoUrl: footerCfg.footer_logo_url,
        footerSocials: footerCfg.footer_socials || {},
        variables: c.brand_variables || {},
        // Numa pré-visualização não há destinatário nem link próprio de
        // cancelamento: mostra-se a estrutura, sem endereço inventado.
        email: '',
        unsubUrl: `${APP_URL_PREVIEW}#unsubscribe`,
        previewUrl: '',
      });

      // Numa pré-visualização todos os links devem abrir noutro separador: é o
      // que permite clicá-los sem perder a página de pré-visualização, e é a
      // única navegação que o sandbox do iframe autoriza (allow-popups). Sem
      // isto, um link com target="_self" ficava simplesmente inerte.
      const semComentario = c.html_content.replace(/<!--teBlocks:[A-Za-z0-9+/=]+-->/g, '')
        .replace(/<\/body>/i, `${rodape}</body>`);
      const emailHtml = /<head[^>]*>/i.test(semComentario)
        ? semComentario.replace(/<head([^>]*)>/i, '<head$1><base target="_blank">')
        : `<base target="_blank">${semComentario}`;
      const brandRight = c.brand_logo
        ? `<img src="${esc(c.brand_logo)}" alt="${esc(c.brand_name||'')}" class="bar-logo">`
        : `<span class="bar-brand">${esc(c.brand_name||'')}</span>`;
      const html = `<!DOCTYPE html>
<html lang="pt"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(c.subject || c.name)} — Pré-visualização</title>
<meta name="robots" content="noindex,nofollow">
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#f1f5f9;min-height:100vh;font-family:system-ui,sans-serif}
.bar{background:#0f172a;color:#fff;padding:10px 20px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100}
.bar-left{display:flex;align-items:center;gap:10px}.bar-tag{background:#1e293b;color:#94a3b8;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
.bar-name{color:#f8fafc;font-weight:600;font-size:13px}.bar-sub{color:#94a3b8;font-size:12px;margin-top:1px}.bar-brand{color:#64748b;font-size:12px}
.bar-logo{height:32px;width:auto;object-fit:contain;display:block;filter:brightness(0) invert(1);opacity:.85}
.wrap{padding:24px 16px;display:flex;justify-content:center}iframe{border:none;background:#fff;box-shadow:0 4px 32px rgba(0,0,0,.12);border-radius:8px;width:100%;max-width:680px;min-height:500px;display:block}</style>
</head><body>
<div class="bar"><div class="bar-left"><span class="bar-tag">Pré-visualização</span><div><div class="bar-name">${esc(c.name||'Campanha')}</div>${c.subject?`<div class="bar-sub">${esc(c.subject)}</div>`:''}</div></div>${brandRight}</div>
<div class="wrap"><iframe id="f" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" title="Pré-visualização do email"></iframe></div>
<script>(function(){const h=${JSON.stringify(emailHtml)};const f=document.getElementById('f');f.srcdoc=h;f.addEventListener('load',function(){try{const s=f.contentDocument.documentElement.scrollHeight;if(s>100)f.style.height=s+'px';}catch(_){}});})();</script>
</body></html>`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('X-Robots-Tag', 'noindex');
      return res.status(200).send(html);
    } catch (err) {
      console.error('preview:', err);
      return res.status(500).send(errPage('Erro de servidor.'));
    }
  }

  if (type === 'click') {
    // Validate HMAC token before trusting the url param — prevents open-redirect abuse.
    let dest = '/';
    try {
      if (cid && uid && t) {
        const expected = trackToken(cid, uid);
        const campaignId = parseInt(cid, 10);
        const contactId  = parseInt(uid, 10);
        const valid = t.length === expected.length
          && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(expected));
        if (valid && !isNaN(campaignId) && !isNaN(contactId)) {
          if (url && url.startsWith('http')) dest = url;
          // uid=0 é o clique de um email de teste: encaminha-se para o
          // destino, mas não se registra — não há contacto 0 e não deve
          // contar nas estatísticas da campanha.
          if (contactId !== 0) {
            await query(
              `INSERT INTO email_events (campaign_id, contact_id, type, url, created_at) VALUES ($1, $2, 'click', $3, NOW())`,
              [campaignId, contactId, url || null]
            );
          }
        }
      }
    } catch (e) {
      console.error('track click error:', e.message);
    }
    res.setHeader('Location', dest);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(302).end();
  }

  // Open pixel — record BEFORE returning the image.
  // Skip known mail proxy / security scanner user-agents that pre-fetch images
  // without the user opening the email (e.g. Gmail Image Proxy, Yahoo Mail,
  // Proofpoint, Barracuda, Apple Mail Privacy Protection prefetch, etc.).
  const ua = (req.headers['user-agent'] || '').toLowerCase();
  const isMailBot = /googleimageproxy|ggpht\.com|yahooimageproxy|yahoo.*mail.*proxy|preview\.mail\.icloud|mail-proxy|mimecast|proofpoint|barracuda|cloudmark|symantec.*email|messagelabs|sophos|ironport|postfix|spamassassin|url.*scanner|link.*scanner|phishtank|avira|kaspersky.*mail/i.test(ua);

  if (!isMailBot) {
    try {
      if (cid && uid && t) {
        const expected = trackToken(cid, uid);
        const campaignId = parseInt(cid, 10);
        const contactId  = parseInt(uid, 10);
        if (t === expected && !isNaN(campaignId) && !isNaN(contactId)) {
          await query(
            `INSERT INTO email_events (campaign_id, contact_id, type, created_at) VALUES ($1, $2, 'open', NOW())`,
            [campaignId, contactId]
          );
        }
      }
    } catch (e) {
      console.error('track open error:', e.message);
    }
  }
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  return res.status(200).end(PIXEL);
};
