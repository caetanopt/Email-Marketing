const { query } = require('../../lib/db');
const { requireAuth, cors } = require('../../lib/auth');

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  const user = requireAuth(req, res);
  if (!user) return;

  // Only owners can manage global settings
  const roleRow = await query(
    `SELECT role FROM user_brand_roles WHERE user_id=$1 AND role='owner' LIMIT 1`,
    [user.id]
  );
  if (!roleRow[0]) return res.status(403).json({ error: 'Acesso restrito a administradores' });

  const { action } = req.query;

  // ── Domain whitelist ──────────────────────────────────────
  if (action === 'domain_whitelist' || !action) {
    if (req.method === 'GET') {
      const rows = await query(
        `SELECT dw.id, dw.domain, dw.note, dw.created_at, u.name AS created_by_name
         FROM domain_whitelist dw
         LEFT JOIN users u ON u.id = dw.created_by
         ORDER BY dw.created_at DESC`
      );
      return res.status(200).json({ data: rows });
    }

    if (req.method === 'POST') {
      const { domain, note } = req.body || {};
      if (!domain) return res.status(400).json({ error: 'Domínio obrigatório' });
      const clean = domain.trim().toLowerCase().replace(/^@/, '');
      if (!DOMAIN_RE.test(clean)) return res.status(400).json({ error: 'Domínio inválido. Exemplo: empresa.pt' });
      try {
        const rows = await query(
          `INSERT INTO domain_whitelist (domain, note, created_by) VALUES ($1, $2, $3)
           ON CONFLICT (domain) DO NOTHING RETURNING id`,
          [clean, note || null, user.id]
        );
        if (!rows[0]) return res.status(409).json({ error: 'Domínio já existe na lista' });
        return res.status(201).json({ id: rows[0].id, domain: clean });
      } catch (err) {
        return res.status(500).json({ error: 'Erro de servidor' });
      }
    }

    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id obrigatório' });
      await query('DELETE FROM domain_whitelist WHERE id=$1', [id]);
      return res.status(200).json({ ok: true });
    }
  }

  res.status(405).json({ error: 'Método não permitido' });
};
