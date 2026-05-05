const { query } = require('../../lib/db');
const { requireAuth, cors } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  const user = requireAuth(req, res);
  if (!user) return;

  try {
    if (req.method === 'GET') {
      const { id } = req.query;
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

    if (req.method === 'PUT') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id obrigatório' });
      const role = await query('SELECT role FROM user_brand_roles WHERE user_id=$1 AND brand_id=$2', [user.id, id]);
      if (!role[0] || !['owner','admin'].includes(role[0].role)) return res.status(403).json({ error: 'Sem permissão' });
      const { name, color, logo_url, from_name, from_email, reply_to } = req.body || {};
      await query(
        `UPDATE brands SET name=COALESCE($1,name), color=COALESCE($2,color), logo_url=$3,
         from_name=COALESCE($4,from_name), from_email=COALESCE($5,from_email), reply_to=$6
         WHERE id=$7`,
        [name||null, color||null, logo_url||null, from_name||null, from_email||null, reply_to||null, id]
      );
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: 'Método não permitido' });
  } catch (err) {
    res.status(500).json({ error: 'Erro de servidor', detail: err.message });
  }
};
