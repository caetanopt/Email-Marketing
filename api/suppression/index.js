const { query } = require('../../lib/db');
const { requireAuth, cors } = require('../../lib/auth');
const crypto = require('crypto');

function verifyToken(email, brandId, token) {
  const expected = crypto.createHmac('sha256', process.env.JWT_SECRET || 'secret')
    .update(`${email}:${brandId}`)
    .digest('hex');
  return token === expected;
}

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;

  const { brand_id, search, page = 1, limit = 50, action, email: qEmail, token } = req.query;

  // Public one-click unsubscribe — no auth required, token-protected
  if (action === 'unsubscribe' && brand_id && qEmail) {
    if (!token || !verifyToken(qEmail, brand_id, token)) {
      return res.status(400).send('<p>Link inválido ou expirado.</p>');
    }
    try {
      const e = qEmail.toLowerCase().trim();
      await query(
        'INSERT INTO suppression (brand_id, email, reason) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [brand_id, e, 'unsubscribe']
      );
      await query("UPDATE contacts SET status='suppressed' WHERE brand_id=$1 AND email=$2", [brand_id, e]);
      res.setHeader('Content-Type', 'text/html');
      return res.status(200).send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Cancelado</title></head>
        <body style="font-family:sans-serif;text-align:center;padding:60px;color:#334155">
        <h2>Subscrição cancelada</h2>
        <p>O endereço <strong>${e}</strong> foi removido da nossa lista.</p>
        </body></html>`);
    } catch(err) {
      return res.status(500).send('<p>Erro interno. Tente novamente.</p>');
    }
  }

  const user = requireAuth(req, res);
  if (!user) return;

  if (!brand_id) return res.status(400).json({ error: 'brand_id obrigatório' });

  try {
    if (req.method === 'GET') {
      const params = [brand_id];
      let where = 'WHERE brand_id=$1';
      if (search) { params.push(`%${search}%`); where += ` AND email ILIKE $${params.length}`; }
      params.push(parseInt(limit));
      params.push((parseInt(page) - 1) * parseInt(limit));
      const rows = await query(
        `SELECT id, email, reason, created_at FROM suppression ${where}
         ORDER BY created_at DESC LIMIT $${params.length-1} OFFSET $${params.length}`,
        params
      );
      return res.status(200).json({ data: rows });
    }

    if (req.method === 'POST') {
      const { email, reason } = req.body || {};
      if (!email) return res.status(400).json({ error: 'Email obrigatório' });
      const e = email.toLowerCase().trim();
      await query(
        'INSERT INTO suppression (brand_id, email, reason) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [brand_id, e, reason||'manual']
      );
      await query("UPDATE contacts SET status='suppressed' WHERE brand_id=$1 AND email=$2", [brand_id, e]);
      return res.status(201).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const { email } = req.body || {};
      if (!email) return res.status(400).json({ error: 'Email obrigatório' });
      await query('DELETE FROM suppression WHERE brand_id=$1 AND email=$2',
        [brand_id, email.toLowerCase().trim()]);
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: 'Método não permitido' });
  } catch (err) {
    res.status(500).json({ error: 'Erro de servidor', detail: err.message });
  }
};
