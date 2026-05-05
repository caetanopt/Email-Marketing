const bcrypt = require('bcryptjs');
const { query } = require('../../lib/db');
const { requireAuth, cors } = require('../../lib/auth');

async function isAdmin(userId, brandId) {
  const r = await query('SELECT role FROM user_brand_roles WHERE user_id=$1 AND brand_id=$2', [userId, brandId]);
  return r[0] && ['owner','admin'].includes(r[0].role);
}

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  const user = requireAuth(req, res);
  if (!user) return;

  const { id, action, member_id } = req.query;

  try {
    if (req.method === 'GET') {
      if (id && action === 'team') {
        const rows = await query(
          `SELECT u.id, u.name, u.email, u.active, u.last_login, ubr.role
           FROM user_brand_roles ubr JOIN users u ON u.id = ubr.user_id
           WHERE ubr.brand_id = $1 ORDER BY u.name`,
          [id]
        );
        return res.status(200).json({ data: rows });
      }
      if (id) {
        const rows = await query(
          `SELECT b.*, ubr.role FROM brands b
           JOIN user_brand_roles ubr ON ubr.brand_id = b.id AND ubr.user_id = $1
           WHERE b.id = $2`,
          [user.id, id]
        );
        if (!rows[0]) return res.status(404).json({ error: 'Marca não encontrada' });
        return res.status(200).json(rows[0]);
      }
      const rows = await query(
        `SELECT b.id, b.name, b.color, b.logo_url, b.from_name, b.from_email, ubr.role
         FROM brands b
         JOIN user_brand_roles ubr ON ubr.brand_id = b.id AND ubr.user_id = $1
         WHERE b.active = TRUE ORDER BY b.name`,
        [user.id]
      );
      return res.status(200).json({ data: rows });
    }

    if (req.method === 'POST' && id && action === 'invite') {
      if (!await isAdmin(user.id, id)) return res.status(403).json({ error: 'Sem permissão' });
      const { name, email, password, role } = req.body || {};
      if (!name || !email || !password) return res.status(400).json({ error: 'name, email e password obrigatórios' });
      const safeRole = ['owner','admin','editor','viewer'].includes(role) ? role : 'editor';
      const hash = bcrypt.hashSync(password, 10);
      // Get or create user
      let u = await query('SELECT id FROM users WHERE email=$1', [email.toLowerCase().trim()]);
      let userId;
      if (u[0]) userId = u[0].id;
      else {
        const r = await query(
          'INSERT INTO users (name, email, password_hash) VALUES ($1,$2,$3) RETURNING id',
          [name, email.toLowerCase().trim(), hash]
        );
        userId = r[0].id;
      }
      await query(
        `INSERT INTO user_brand_roles (user_id, brand_id, role) VALUES ($1,$2,$3)
         ON CONFLICT (user_id, brand_id) DO UPDATE SET role=EXCLUDED.role`,
        [userId, id, safeRole]
      );
      return res.status(201).json({ ok: true, user_id: userId });
    }

    if (req.method === 'PUT' && id && action === 'update_role' && member_id) {
      if (!await isAdmin(user.id, id)) return res.status(403).json({ error: 'Sem permissão' });
      const { role } = req.body || {};
      if (!['owner','admin','editor','viewer'].includes(role)) return res.status(400).json({ error: 'role inválido' });
      await query('UPDATE user_brand_roles SET role=$1 WHERE user_id=$2 AND brand_id=$3', [role, member_id, id]);
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE' && id && action === 'remove_member' && member_id) {
      if (!await isAdmin(user.id, id)) return res.status(403).json({ error: 'Sem permissão' });
      if (parseInt(member_id) === user.id) return res.status(400).json({ error: 'Não podes remover-te a ti próprio' });
      await query('DELETE FROM user_brand_roles WHERE user_id=$1 AND brand_id=$2', [member_id, id]);
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'PUT') {
      if (!id) return res.status(400).json({ error: 'id obrigatório' });
      if (!await isAdmin(user.id, id)) return res.status(403).json({ error: 'Sem permissão' });
      const { name, color, logo_url, from_name, from_email, reply_to, header_html, footer_html } = req.body || {};
      await query(
        `UPDATE brands SET name=COALESCE($1,name), color=COALESCE($2,color), logo_url=$3,
         from_name=COALESCE($4,from_name), from_email=COALESCE($5,from_email), reply_to=$6,
         header_html=$7, footer_html=$8
         WHERE id=$9`,
        [name||null, color||null, logo_url||null, from_name||null, from_email||null, reply_to||null,
         header_html||null, footer_html||null, id]
      );
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: 'Método não permitido' });
  } catch (err) {
    res.status(500).json({ error: 'Erro de servidor', detail: err.message });
  }
};
