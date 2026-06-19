const crypto = require('crypto');
const { query } = require('../lib/db');

function cors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return true; }
  return false;
}

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function errPage(msg) {
  return `<!DOCTYPE html><html lang="pt"><head><meta charset="UTF-8"><title>Erro — PrimeMail</title>
<style>body{font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;background:#f1f5f9;color:#334155;gap:8px}
p{font-size:15px}small{color:#94a3b8;font-size:12px}</style></head>
<body><p>${msg}</p><small>PrimeMail</small></body></html>`;
}

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).end();

  const { id, token } = req.query;
  if (!id || !token) return res.status(400).send(errPage('Link inválido.'));

  if (!process.env.JWT_SECRET) return res.status(500).send(errPage('Configuração em falta.'));
  const expected = crypto.createHmac('sha256', process.env.JWT_SECRET)
    .update(`preview:${id}`).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(expected, 'hex'))) {
    return res.status(403).send(errPage('Link inválido ou sem permissão.'));
  }

  try {
    const rows = await query(
      `SELECT c.name, c.subject, b.name AS brand_name, t.html_content
       FROM campaigns c
       LEFT JOIN templates t ON t.id = c.template_id
       LEFT JOIN brands b ON b.id = c.brand_id
       WHERE c.id = $1`,
      [id]
    );
    if (!rows[0]) return res.status(404).send(errPage('Campanha não encontrada.'));
    const c = rows[0];
    if (!c.html_content) return res.status(404).send(errPage('Esta campanha não tem um template de email associado.'));

    // Strip internal block-state comment — not needed for external preview
    const emailHtml = c.html_content.replace(/<!--teBlocks:[A-Za-z0-9+/=]+-->/g, '');

    const html = `<!DOCTYPE html>
<html lang="pt">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(c.subject || c.name)} — Pré-visualização</title>
<meta name="robots" content="noindex,nofollow">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#f1f5f9;min-height:100vh;font-family:system-ui,sans-serif}
.bar{background:#0f172a;color:#fff;padding:10px 20px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100}
.bar-left{display:flex;align-items:center;gap:10px}
.bar-tag{background:#1e293b;color:#94a3b8;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
.bar-name{color:#f8fafc;font-weight:600;font-size:13px}
.bar-sub{color:#94a3b8;font-size:12px;margin-top:1px}
.bar-brand{color:#64748b;font-size:12px}
.wrap{padding:24px 16px;display:flex;justify-content:center}
iframe{border:none;background:#fff;box-shadow:0 4px 32px rgba(0,0,0,.12);border-radius:8px;width:100%;max-width:680px;min-height:500px;display:block}
</style>
</head>
<body>
<div class="bar">
  <div class="bar-left">
    <span class="bar-tag">Pré-visualização</span>
    <div>
      <div class="bar-name">${escHtml(c.name || 'Campanha')}</div>
      ${c.subject ? `<div class="bar-sub">${escHtml(c.subject)}</div>` : ''}
    </div>
  </div>
  <div class="bar-brand">${escHtml(c.brand_name || '')}</div>
</div>
<div class="wrap">
  <iframe id="f" sandbox="allow-same-origin" title="Pré-visualização do email"></iframe>
</div>
<script>
(function(){
  const html = ${JSON.stringify(emailHtml)};
  const f = document.getElementById('f');
  f.srcdoc = html;
  f.addEventListener('load', function() {
    try {
      const h = f.contentDocument.documentElement.scrollHeight;
      if (h > 100) f.style.height = h + 'px';
    } catch(_) {}
  });
})();
</script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Robots-Tag', 'noindex');
    return res.status(200).send(html);
  } catch (err) {
    console.error('preview:', err);
    return res.status(500).send(errPage('Erro de servidor.'));
  }
};
