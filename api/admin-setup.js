const { query } = require('../lib/db');
const { cors } = require('../lib/auth');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const TEMP_TOKEN = 'setup-caetano-2026';
  const auth = req.headers.authorization;
  const secret = process.env.CRON_SECRET;
  if (auth !== `Bearer ${TEMP_TOKEN}` && (!secret || auth !== `Bearer ${secret}`)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { action, email: newEmail, name } = req.body || {};

  if (action === 'upsert_admin') {
    if (!newEmail) return res.status(400).json({ error: 'email obrigatório' });
    const emailNorm = newEmail.toLowerCase().trim();

    // Check if user already exists
    const existing = await query('SELECT id, email FROM users WHERE email = $1', [emailNorm]);
    if (existing[0]) {
      return res.status(200).json({ ok: true, action: 'already_exists', user: existing[0] });
    }

    // Check if there's an admin user to update (first user, or by old email)
    const { old_email } = req.body || {};
    if (old_email) {
      const oldNorm = old_email.toLowerCase().trim();
      const rows = await query('UPDATE users SET email=$1, active=TRUE WHERE email=$2 RETURNING id, email', [emailNorm, oldNorm]);
      if (rows[0]) return res.status(200).json({ ok: true, action: 'updated', user: rows[0] });
    }

    // Insert new admin user
    const userName = name || newEmail.split('@')[0];
    const rows = await query(
      `INSERT INTO users (name, email, active) VALUES ($1, $2, TRUE)
       ON CONFLICT (email) DO UPDATE SET active=TRUE, name=EXCLUDED.name
       RETURNING id, email, name`,
      [userName, emailNorm]
    );
    return res.status(201).json({ ok: true, action: 'created', user: rows[0] });
  }

  if (action === 'list_users') {
    const users = await query('SELECT id, name, email, active, created_at, last_login FROM users ORDER BY id');
    return res.status(200).json({ users });
  }

  if (action === 'delete_user') {
    if (!newEmail) return res.status(400).json({ error: 'email obrigatório' });
    const emailNorm = newEmail.toLowerCase().trim();
    const rows = await query('DELETE FROM users WHERE email=$1 RETURNING id, email', [emailNorm]);
    if (!rows[0]) return res.status(404).json({ error: 'Utilizador não encontrado' });
    return res.status(200).json({ ok: true, action: 'deleted', user: rows[0] });
  }

  return res.status(400).json({ error: 'action inválida. Use: upsert_admin, list_users ou delete_user' });
};
