const { query } = require('../../lib/db');
const { withAuth, requireBrand, requireWrite, requireWriteAny } = require('../../lib/auth');

// O data_url de um ícone só pode ser um data URI de imagem em base64 — é isso
// que o browser produz (FileReader.readAsDataURL). Aceitar mais do que isto
// deixava passar qualquer texto, e o valor acaba dentro de src="..." no painel:
// uma aspa no meio fecha o atributo e acrescenta um onerror à tag <img>.
// A expressão exclui por construção aspas, espaços e sinais de menor.
const DATA_URL_IMAGEM = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

module.exports = withAuth(async (req, res, user) => {

  const { brand_id, id } = req.query;

  // DELETE /api/icons?id=X
  if (req.method === 'DELETE') {
    if (!id) return res.status(400).json({ error: 'id obrigatório' });
    // Apagar é escrita: um viewer não apaga. O WHERE abaixo continua a limitar
    // ao criador ou às marcas do utilizador.
    if (!await requireWriteAny(req, res, user.id)) return;
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
      return res.status(500).json({ error: 'Erro de servidor' });
    }
  }

  if (!brand_id) return res.status(400).json({ error: 'brand_id obrigatório' });
  if (!await requireBrand(req, res, user.id, brand_id)) return;

  try {
    if (req.method === 'GET') {
      try {
        const rows = await query(
          `SELECT id, brand_id, name, mime_type, data_url, created_at
           FROM custom_icons
           WHERE brand_id = $1 OR brand_id IS NULL
           ORDER BY brand_id NULLS LAST, created_at DESC`,
          [brand_id]
        );
        return res.status(200).json({ data: rows });
      } catch (e) {
        if (e.code === '42P01') return res.status(200).json({ data: [], _migration_pending: true });
        throw e;
      }
    }

    if (req.method === 'POST') {
      // Criar um ícone é escrita na marca — requireBrand (acima) só confirma
      // que o utilizador tem ALGUM papel nela, e deixava passar um viewer.
      if (!await requireWrite(req, res, user.id, brand_id)) return;

      const { name, data_url, mime_type, scope } = req.body || {};
      if (!name) return res.status(400).json({ error: 'name obrigatório' });
      if (!data_url) return res.status(400).json({ error: 'data_url obrigatório' });
      if (data_url.length > 400000) return res.status(400).json({ error: 'Ficheiro demasiado grande (máx ~300 KB)' });
      // SVG não é suportado pela maioria dos clientes de email — rejeitar.
      if ((mime_type && /svg/i.test(mime_type)) || /^data:image\/svg/i.test(data_url)) {
        return res.status(400).json({ error: 'SVG não é suportado em emails. Usa PNG, JPG ou WebP.' });
      }
      if (!DATA_URL_IMAGEM.test(data_url)) {
        return res.status(400).json({ error: 'Ficheiro inválido: só são aceites imagens PNG, JPG, WebP ou GIF.' });
      }
      // Um ícone global fica visível em TODAS as marcas (brand_id NULL, e o GET
      // devolve os globais a toda a gente). Espalhar conteúdo por todas as
      // marcas é decisão de administrador, não de editor.
      if (scope === 'global') {
        const dono = await query(
          "SELECT 1 FROM user_brand_roles WHERE user_id=$1 AND role='owner' LIMIT 1", [user.id]
        );
        if (!dono[0]) return res.status(403).json({ error: 'Só um administrador pode criar ícones partilhados por todas as marcas.' });
      }
      const targetBrandId = scope === 'global' ? null : brand_id;
      const rows = await query(
        `INSERT INTO custom_icons (brand_id, name, mime_type, data_url, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
        [targetBrandId, name.substring(0, 255), mime_type || 'image/png', data_url, user.id]
      );
      return res.status(201).json({ id: rows[0].id, created_at: rows[0].created_at });
    }

    res.status(405).json({ error: 'Método não permitido' });
  } catch (err) {
    res.status(500).json({ error: 'Erro de servidor' });
  }
});
