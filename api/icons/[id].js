const { query } = require('../../lib/db');
const { requireAuth, cors } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  const user = requireAuth(req, res);
  if (!user) return;

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id obrigatório' });

  if (req.method === 'DELETE') {
    try {
      const rows = await query(
        `DELETE FROM custom_icons
         WHERE id = $1
           AND (created_by = $2
                OR brand_id IN (SELECT brand_id FROM user_brand_roles WHERE user_id = $2)
                OR brand_id IS NULL)
         RETURNING id`,
        [id, user.id]
      );
      if (!rows.length) return res.status(404).json({ error: 'Ícone não encontrado ou sem permissão' });
      return res.status(200).json({ ok: true });
    } catch (e) {
      if (e.code === '42P01') return res.status(503).json({ error: 'Migração em falta: corre 020_custom_icons.sql' });
      return res.status(500).json({ error: 'Erro de servidor', detail: e.message });
    }
  }

  res.status(405).json({ error: 'Método não permitido' });
};
