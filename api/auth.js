const crypto = require('crypto');
const { SendEmailCommand } = require('@aws-sdk/client-ses');
const { query } = require('../lib/db');
const { signToken, requireAuth, cors } = require('../lib/auth');
const { getSESClient } = require('../lib/ses');

const INIT_SQL = `
  CREATE TABLE IF NOT EXISTS magic_link_tokens (
    token      VARCHAR(64) PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    used       BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`;

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;

  // GET ?token=xxx — verify magic link token
  if (req.method === 'GET' && req.query.token) {
    const { token } = req.query;
    try {
      await query(INIT_SQL);
      const rows = await query(
        `SELECT t.user_id, t.expires_at, t.used,
                u.id, u.name, u.email, u.active, u.default_brand_id, u.avatar_url
         FROM magic_link_tokens t
         JOIN users u ON u.id = t.user_id
         WHERE t.token = $1`,
        [token]
      );
      const r = rows[0];
      if (!r || r.used || new Date(r.expires_at) < new Date() || !r.active) {
        return res.status(401).json({ error: 'Link inválido ou expirado. Solicita um novo.' });
      }

      await query('UPDATE magic_link_tokens SET used = TRUE WHERE token = $1', [token]);
      await query('UPDATE users SET last_login = NOW() WHERE id = $1', [r.user_id]);

      let brands = await query(
        'SELECT brand_id, role FROM user_brand_roles WHERE user_id = $1', [r.user_id]
      );
      if (!brands.length) {
        await query(
          `INSERT INTO user_brand_roles (user_id, brand_id, role) VALUES ($1, 'caetano', 'viewer') ON CONFLICT DO NOTHING`,
          [r.user_id]
        );
        brands = [{ brand_id: 'caetano', role: 'viewer' }];
      }

      const jwtToken = signToken({ id: r.user_id, email: r.email, name: r.name });
      return res.status(200).json({
        token: jwtToken,
        user: { id: r.user_id, name: r.name, email: r.email, default_brand_id: r.default_brand_id || null, avatar_url: r.avatar_url || null },
        brands,
      });
    } catch (err) {
      console.error('Magic link verify error:', err);
      return res.status(500).json({ error: 'Erro de servidor' });
    }
  }

  // POST — request magic link
  if (req.method === 'POST') {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Email obrigatório' });

    const emailNorm = email.toLowerCase().trim();
    const okResp = () => res.status(200).json({ ok: true });

    try {
      await query(INIT_SQL);

      const rows = await query(
        'SELECT id FROM users WHERE email = $1 AND active = TRUE', [emailNorm]
      );
      if (!rows[0]) return okResp();

      const userId = rows[0].id;
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

      await query('DELETE FROM magic_link_tokens WHERE user_id = $1', [userId]);
      await query(
        'INSERT INTO magic_link_tokens (token, user_id, expires_at) VALUES ($1, $2, $3)',
        [token, userId, expiresAt]
      );

      const appUrl = (process.env.APP_URL || 'https://email-marketing-eta.vercel.app').replace(/\/$/, '');
      const magicUrl = `${appUrl}/email?magic=${token}`;
      const from = process.env.MAGIC_LINK_FROM || 'PrimeMail <noreply@caetano.pt>';

      await getSESClient().send(new SendEmailCommand({
        Source: from,
        Destination: { ToAddresses: [emailNorm] },
        Message: {
          Subject: { Data: 'O seu link de acesso — PrimeMail' },
          Body: {
            Html: { Data: `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:480px;margin:40px auto;color:#1e293b">
              <img src="https://caetano.pt/site/uploads/2026/01/caetano-002e5d.svg" alt="Caetano" style="height:32px;margin-bottom:24px">
              <h2 style="margin:0 0 8px">Link de acesso ao PrimeMail</h2>
              <p style="color:#64748b;margin:0 0 24px">Clique no botão abaixo para aceder. O link é válido durante <strong>15 minutos</strong>.</p>
              <a href="${magicUrl}" style="display:inline-block;padding:12px 28px;background:#0f172a;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Aceder ao PrimeMail</a>
              <p style="margin-top:24px;font-size:12px;color:#94a3b8">Se não solicitou este acesso, ignore este email.</p>
            </body></html>` },
            Text: { Data: `Link de acesso ao PrimeMail (válido 15 min):\n${magicUrl}\n\nSe não solicitou este acesso, ignore este email.` },
          },
        },
      }));

      return okResp();
    } catch (err) {
      console.error('Magic link send error:', err);
      return res.status(500).json({ error: 'Erro ao enviar email. Tente novamente.' });
    }
  }

  // GET — authenticated user info
  if (req.method === 'GET') {
    const user = requireAuth(req, res);
    if (!user) return;
    try {
      const users = await query(
        'SELECT id, name, email, default_brand_id, avatar_url, created_at, last_login FROM users WHERE id = $1', [user.id]
      );
      if (!users[0]) return res.status(404).json({ error: 'Utilizador não encontrado' });
      const brands = await query(
        `SELECT ubr.brand_id, ubr.role, b.name AS brand_name, b.color
         FROM user_brand_roles ubr JOIN brands b ON b.id = ubr.brand_id
         WHERE ubr.user_id = $1 ORDER BY b.name`,
        [user.id]
      );
      return res.status(200).json({ user: users[0], brands });
    } catch (err) {
      return res.status(500).json({ error: 'Erro de servidor' });
    }
  }

  // PUT — update user profile
  if (req.method === 'PUT') {
    const user = requireAuth(req, res);
    if (!user) return;
    const body = req.body || {};
    const { default_brand_id, avatar_url, name } = body;
    const sets = ['default_brand_id = $1'];
    const params = [default_brand_id || null];
    if (Object.prototype.hasOwnProperty.call(body, 'name') && name?.trim()) {
      params.push(name.trim());
      sets.push(`name = $${params.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'avatar_url')) {
      params.push(avatar_url || null);
      sets.push(`avatar_url = $${params.length}`);
    }
    params.push(user.id);
    try {
      await query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: 'Erro de servidor' });
    }
  }

  // DELETE — admin setup actions (list_users, upsert_admin, delete_user)
  if (req.method === 'DELETE') {
    const TEMP_TOKEN = 'setup-caetano-2026';
    const auth = req.headers.authorization;
    const secret = process.env.CRON_SECRET;
    if (auth !== `Bearer ${TEMP_TOKEN}` && (!secret || auth !== `Bearer ${secret}`)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const { action, email: targetEmail, old_email, name } = req.body || {};

    if (action === 'list_users') {
      const users = await query('SELECT id, name, email, active, created_at, last_login FROM users ORDER BY id');
      return res.status(200).json({ users });
    }
    if (action === 'upsert_admin') {
      if (!targetEmail) return res.status(400).json({ error: 'email obrigatório' });
      const emailNorm = targetEmail.toLowerCase().trim();
      if (old_email) {
        const rows = await query('UPDATE users SET email=$1, active=TRUE WHERE email=$2 RETURNING id, email', [emailNorm, old_email.toLowerCase().trim()]);
        if (rows[0]) return res.status(200).json({ ok: true, action: 'updated', user: rows[0] });
      }
      const userName = name || emailNorm.split('@')[0];
      const rows = await query(
        `INSERT INTO users (name, email, active) VALUES ($1, $2, TRUE)
         ON CONFLICT (email) DO UPDATE SET active=TRUE, name=EXCLUDED.name
         RETURNING id, email, name`,
        [userName, emailNorm]
      );
      return res.status(201).json({ ok: true, action: 'created', user: rows[0] });
    }
    if (action === 'delete_user') {
      if (!targetEmail) return res.status(400).json({ error: 'email obrigatório' });
      const emailNorm = targetEmail.toLowerCase().trim();
      try {
        const found = await query('SELECT id, email FROM users WHERE email=$1', [emailNorm]);
        if (!found[0]) return res.status(404).json({ error: 'Utilizador não encontrado' });
        const uid = found[0].id;
        try { await query('DELETE FROM magic_link_tokens WHERE user_id=$1', [uid]); } catch (e1) { return res.status(500).json({ error: 'magic_link_tokens: ' + e1.message }); }
        try { await query('DELETE FROM user_brand_areas WHERE user_id=$1', [uid]); } catch (_) {}
        try { await query('DELETE FROM user_brand_roles WHERE user_id=$1', [uid]); } catch (e2) { return res.status(500).json({ error: 'user_brand_roles: ' + e2.message }); }
        try { await query('UPDATE media SET created_by=NULL WHERE created_by=$1', [uid]); } catch (_) {}
        try { await query('DELETE FROM users WHERE id=$1', [uid]); } catch (e3) { return res.status(500).json({ error: 'users: ' + e3.message }); }
        return res.status(200).json({ ok: true, action: 'deleted', user: found[0] });
      } catch (err) {
        return res.status(500).json({ error: err.message, stack: err.stack?.split('\n')[0] });
      }
    }
    if (action === 'update_role') {
      const { role } = req.body || {};
      if (!targetEmail || !role) return res.status(400).json({ error: 'email e role obrigatórios' });
      if (!['owner','editor','viewer'].includes(role)) return res.status(400).json({ error: 'role inválido: owner, editor ou viewer' });
      const found = await query('SELECT id FROM users WHERE email=$1', [targetEmail.toLowerCase().trim()]);
      if (!found[0]) return res.status(404).json({ error: 'Utilizador não encontrado' });
      await query('UPDATE user_brand_roles SET role=$1 WHERE user_id=$2', [role, found[0].id]);
      return res.status(200).json({ ok: true, action: 'role_updated', user_id: found[0].id, role });
    }
    if (action === 'clear_list') {
      const { list_name } = req.body || {};
      if (!list_name) return res.status(400).json({ error: 'list_name obrigatório' });
      const lists = await query('SELECT id, name FROM lists WHERE LOWER(name)=LOWER($1)', [list_name]);
      if (!lists[0]) return res.status(404).json({ error: 'Lista não encontrada' });
      const deleted = await query('DELETE FROM list_members WHERE list_id=$1 RETURNING contact_id', [lists[0].id]);
      return res.status(200).json({ ok: true, list: lists[0].name, list_id: lists[0].id, removed: deleted.length });
    }
    return res.status(400).json({ error: 'action inválida' });
  }

  res.status(405).json({ error: 'Método não permitido' });
};
