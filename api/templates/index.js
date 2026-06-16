const { query } = require('../../lib/db');
const { requireAuth, cors } = require('../../lib/auth');
const Anthropic = require('@anthropic-ai/sdk');

async function authorizeTemplate(userId, templateId) {
  const r = await query(
    `SELECT t.*
     FROM templates t
     JOIN user_brand_roles ubr ON ubr.brand_id = t.brand_id AND ubr.user_id = $2
     WHERE t.id = $1`,
    [templateId, userId]
  );
  return r[0] || null;
}
async function authorizeBrand(userId, brandId) {
  const r = await query('SELECT 1 FROM user_brand_roles WHERE user_id=$1 AND brand_id=$2', [userId, brandId]);
  return r.length > 0;
}

async function handleImageToMjml(req, res) {
  const { image_base64, image_type } = req.body || {};
  if (!image_base64 || !image_type) {
    return res.status(400).json({ error: 'image_base64 e image_type obrigatórios' });
  }
  const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (!validTypes.includes(image_type)) {
    return res.status(400).json({ error: 'Tipo de imagem inválido' });
  }
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: image_type, data: image_base64 }
        },
        {
          type: 'text',
          text: `Analisa esta imagem de um email de marketing e converte-a em código MJML válido e completo.

Regras:
- Usa componentes MJML nativos: mj-section, mj-column, mj-text, mj-image, mj-button, mj-divider, mj-spacer, mj-hero, mj-navbar, etc.
- Preserva as cores, fontes, espaçamentos e layout visuais da imagem o máximo possível.
- Para imagens no design, usa URLs placeholder: https://via.placeholder.com/WIDTHxHEIGHT
- Para textos visíveis, usa o texto real da imagem.
- O código deve começar com <mjml> e terminar com </mjml>.
- Não incluas explicações, comentários ou markdown — só o código MJML puro.`
        }
      ]
    }]
  });
  const mjml = response.content[0]?.text?.trim() || '';
  return res.status(200).json({ mjml });
}

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  const user = requireAuth(req, res);
  if (!user) return;

  const { brand_id, id, target_brand_id, action } = req.query;

  // AI: image → MJML
  if (action === 'image-to-mjml') {
    if (req.method === 'GET') {
      return res.status(200).json({ configured: !!process.env.ANTHROPIC_API_KEY });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ error: 'ANTHROPIC_API_KEY não configurada. Adiciona-a nas variáveis de ambiente da Vercel.' });
    }
    try {
      return await handleImageToMjml(req, res);
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Erro de servidor' });
    }
  }

  // Operations on a specific template (id present)
  if (id) {
    try {
      const tpl = await authorizeTemplate(user.id, id);
      if (!tpl) return res.status(404).json({ error: 'Template não encontrado' });

      if (req.method === 'GET') return res.status(200).json(tpl);

      if (req.method === 'PUT') {
        const { name, subject, preview_text, html_content } = req.body || {};
        await query(
          'UPDATE templates SET name=COALESCE($1,name), subject=$2, preview_text=$3, html_content=COALESCE($4,html_content), updated_at=NOW() WHERE id=$5 AND brand_id=$6',
          [name||null, subject||null, preview_text||null, html_content||null, id, tpl.brand_id]
        );
        return res.status(200).json({ ok: true });
      }

      if (req.method === 'DELETE') {
        await query('DELETE FROM templates WHERE id=$1 AND brand_id=$2', [id, tpl.brand_id]);
        return res.status(200).json({ ok: true });
      }

      if (req.method === 'POST') {
        if (!target_brand_id) return res.status(400).json({ error: 'target_brand_id obrigatório' });
        if (!await authorizeBrand(user.id, target_brand_id)) return res.status(403).json({ error: 'Sem permissão na marca destino' });
        const rows = await query(
          'INSERT INTO templates (brand_id, name, subject, preview_text, html_content, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
          [target_brand_id, `${tpl.name} (cópia)`, tpl.subject, tpl.preview_text, tpl.html_content, user.id]
        );
        return res.status(201).json({ id: rows[0].id });
      }

      return res.status(405).json({ error: 'Método não permitido' });
    } catch (err) {
      return res.status(500).json({ error: 'Erro de servidor' });
    }
  }

  // Operations on the collection (brand_id required)
  if (!brand_id) return res.status(400).json({ error: 'brand_id obrigatório' });
  if (!await authorizeBrand(user.id, brand_id)) return res.status(403).json({ error: 'Acesso negado a esta marca' });

  try {
    if (req.method === 'GET') {
      const rows = await query(
        'SELECT id, name, subject, preview_text, created_at, updated_at FROM templates WHERE brand_id=$1 ORDER BY updated_at DESC',
        [brand_id]
      );
      return res.status(200).json({ data: rows });
    }

    if (req.method === 'POST') {
      const { name, subject, preview_text, html_content } = req.body || {};
      if (!name) return res.status(400).json({ error: 'Nome obrigatório' });
      const rows = await query(
        'INSERT INTO templates (brand_id, name, subject, preview_text, html_content, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
        [brand_id, name, subject||null, preview_text||null, html_content||'', user.id]
      );
      return res.status(201).json({ id: rows[0].id, name });
    }

    res.status(405).json({ error: 'Método não permitido' });
  } catch (err) {
    res.status(500).json({ error: 'Erro de servidor' });
  }
};
