const { query } = require('../../lib/db');
const { requireAuth, cors } = require('../../lib/auth');
const crypto = require('crypto');

function verifyToken(email, brandId, token) {
  if (!process.env.JWT_SECRET) return false;
  const expected = crypto.createHmac('sha256', process.env.JWT_SECRET)
    .update(`${email}:${brandId}`)
    .digest('hex');
  return token === expected;
}

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;

  const { brand_id, search, reason, page = 1, limit = 50, action, email: qEmail, token } = req.query;

  // Public brand info for the unsubscribe page header (name + color only).
  if (action === 'brand_info' && brand_id) {
    try {
      const rows = await query('SELECT name, color, logo_url FROM brands WHERE id=$1 AND active=TRUE', [brand_id]);
      if (!rows[0]) return res.status(404).json({ error: 'Marca não encontrada' });
      return res.status(200).json(rows[0]);
    } catch (err) {
      return res.status(500).json({ error: 'Erro de servidor' });
    }
  }

  // Public one-click unsubscribe — no auth required, token-protected.
  // Accepts both GET (one-click from email client) and POST (form submit with reason).
  if (action === 'unsubscribe' && brand_id && qEmail) {
    if (!token || !verifyToken(qEmail, brand_id, token)) {
      const isJson = (req.headers.accept || '').includes('application/json');
      if (isJson) return res.status(400).json({ error: 'Link inválido ou expirado.' });
      return res.status(400).send('<p>Link inválido ou expirado.</p>');
    }
    try {
      const e = qEmail.toLowerCase().trim();
      const userReason = (req.body && req.body.reason) || (req.query.reason) || '';
      const details = userReason ? String(userReason).slice(0, 200) : null;
      try {
        await query(
          `INSERT INTO suppression (email, reason, details) VALUES ($1,'unsubscribe',$2)
           ON CONFLICT (email) DO UPDATE SET reason='unsubscribe', details=COALESCE(EXCLUDED.details, suppression.details)`,
          [e, details]
        );
      } catch (e1) {
        if (e1.code === '42703') {
          await query(
            `INSERT INTO suppression (email, reason) VALUES ($1,'unsubscribe')
             ON CONFLICT (email) DO UPDATE SET reason='unsubscribe'`,
            [e]
          );
        } else { throw e1; }
      }
      // Mark contact as unsubscribed across all brands
      await query("UPDATE contacts SET status='unsubscribed' WHERE email=$1", [e]);
      // Track event for reporting
      try {
        await query(
          `INSERT INTO email_events (campaign_id, contact_id, type)
           SELECT cr.campaign_id, c.id, 'unsubscribe' FROM contacts c
           LEFT JOIN campaign_recipients cr ON cr.contact_id=c.id
           WHERE c.brand_id=$1 AND c.email=$2 ORDER BY cr.sent_at DESC NULLS LAST LIMIT 1`,
          [brand_id, e]
        );
      } catch (err) { console.error('unsubscribe event log:', err); }
      const isJson = (req.headers.accept || '').includes('application/json');
      if (isJson) return res.status(200).json({ ok: true, email: e });
      res.setHeader('Content-Type', 'text/html');
      return res.status(200).send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Cancelado</title></head>
        <body style="font-family:sans-serif;text-align:center;padding:60px;color:#334155">
        <h2>Subscrição cancelada</h2>
        <p>O endereço <strong>${e}</strong> foi removido da nossa lista.</p>
        </body></html>`);
    } catch(err) {
      const isJson = (req.headers.accept || '').includes('application/json');
      if (isJson) return res.status(500).json({ error: 'Erro interno. Tenta novamente.' });
      return res.status(500).send('<p>Erro interno. Tente novamente.</p>');
    }
  }

  // Public resubscribe — token-protected
  if (action === 'resubscribe' && brand_id && qEmail) {
    if (!token || !verifyToken(qEmail, brand_id, token)) {
      return res.status(400).json({ error: 'Link inválido ou expirado.' });
    }
    try {
      const e = qEmail.toLowerCase().trim();
      await query('DELETE FROM suppression WHERE email=$1', [e]);
      await query("UPDATE contacts SET status='active' WHERE email=$1", [e]);
      return res.status(200).json({ ok: true, email: e });
    } catch (err) {
      return res.status(500).json({ error: 'Erro interno.' });
    }
  }

  const user = requireAuth(req, res);
  if (!user) return;

  try {
    if (req.method === 'GET') {
      const filterParams = [];
      const conditions = [];
      if (search) { filterParams.push(`%${search}%`); conditions.push(`email ILIKE $${filterParams.length}`); }
      if (reason) { filterParams.push(reason); conditions.push(`reason=$${filterParams.length}`); }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const [countResult] = await query(
        `SELECT COUNT(*) FROM suppression ${where}`, filterParams
      );
      const total = parseInt(countResult.count);
      const pageParams = [...filterParams];
      pageParams.push(parseInt(limit));
      pageParams.push((parseInt(page) - 1) * parseInt(limit));
      const rows = await query(
        `SELECT id, email, reason, created_at FROM suppression ${where}
         ORDER BY created_at DESC LIMIT $${pageParams.length-1} OFFSET $${pageParams.length}`,
        pageParams
      );
      return res.status(200).json({ data: rows, total });
    }

    if (req.method === 'POST') {
      const { email, reason } = req.body || {};
      if (!email) return res.status(400).json({ error: 'Email obrigatório' });
      const e = email.toLowerCase().trim();
      await query(
        "INSERT INTO suppression (email, reason) VALUES ($1,$2) ON CONFLICT (email) DO NOTHING",
        [e, reason||'manual']
      );
      await query("UPDATE contacts SET status='suppressed' WHERE email=$1", [e]);
      return res.status(201).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const { email } = req.body || {};
      if (!email) return res.status(400).json({ error: 'Email obrigatório' });
      await query('DELETE FROM suppression WHERE email=$1', [email.toLowerCase().trim()]);
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: 'Método não permitido' });
  } catch (err) {
    res.status(500).json({ error: 'Erro de servidor', detail: err.message });
  }
};
