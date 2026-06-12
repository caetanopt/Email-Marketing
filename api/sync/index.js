const { query, transaction } = require('../../lib/db');
const { cors } = require('../../lib/auth');

const VALID_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Resolve brand from Authorization: Bearer <api_key>
async function resolveBrand(req, res) {
  const auth = (req.headers.authorization || '').trim();
  if (!auth.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authorization header obrigatório: Bearer <api_key>' });
    return null;
  }
  const key = auth.slice(7).trim();
  const rows = await query('SELECT id FROM brands WHERE api_key=$1', [key]);
  if (!rows[0]) {
    res.status(401).json({ error: 'API key inválida' });
    return null;
  }
  return rows[0].id;
}

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;

  try {
    // ── GET /api/sync?email=xxx — consultar estado de um contacto ──
    if (req.method === 'GET') {
      const brandId = await resolveBrand(req, res);
      if (!brandId) return;

      const { email } = req.query;
      if (!email) return res.status(400).json({ error: 'Parâmetro email obrigatório' });
      const e = email.toLowerCase().trim();

      const rows = await query(
        `SELECT c.id, c.email, c.name, c.phone, c.company, c.status, c.custom_attributes, c.created_at,
                COALESCE(
                  json_agg(json_build_object('list_id', lm.list_id, 'list_name', l.name))
                  FILTER (WHERE lm.list_id IS NOT NULL), '[]'
                ) AS lists
         FROM contacts c
         LEFT JOIN list_members lm ON lm.contact_id = c.id
         LEFT JOIN lists l ON l.id = lm.list_id
         WHERE c.brand_id=$1 AND c.email=$2
         GROUP BY c.id`,
        [brandId, e]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Contacto não encontrado' });
      return res.status(200).json(rows[0]);
    }

    // ── POST /api/sync — sincronizar (upsert) contactos ──
    if (req.method === 'POST') {
      const brandId = await resolveBrand(req, res);
      if (!brandId) return;

      const { contacts, list_id } = req.body || {};
      if (!Array.isArray(contacts) || !contacts.length)
        return res.status(400).json({ error: 'Campo contacts (array) obrigatório' });

      if (contacts.length > 1000)
        return res.status(400).json({ error: 'Máximo de 1000 contactos por pedido' });

      // Validate list ownership if list_id provided
      if (list_id) {
        const listRows = await query('SELECT id FROM lists WHERE id=$1', [list_id]);
        if (!listRows[0]) return res.status(404).json({ error: 'Lista não encontrada' });
      }

      let synced = 0, failed = 0;
      const errors = [];

      const CHUNK = 10;
      for (let i = 0; i < contacts.length; i += CHUNK) {
        const chunk = contacts.slice(i, i + CHUNK);
        await Promise.all(chunk.map(async (c, idx) => {
          const email = (c.email || '').toLowerCase().trim();
          if (!email || !VALID_EMAIL.test(email)) {
            failed++;
            errors.push({ index: i + idx, email: c.email, reason: 'Email inválido' });
            return;
          }
          try {
            const rows = await query(
              `INSERT INTO contacts (brand_id, email, name, phone, company, source, custom_attributes)
               VALUES ($1,$2,$3,$4,$5,'api',$6)
               ON CONFLICT (brand_id, email) DO UPDATE
                 SET name=COALESCE(EXCLUDED.name, contacts.name),
                     phone=COALESCE(EXCLUDED.phone, contacts.phone),
                     company=COALESCE(EXCLUDED.company, contacts.company),
                     custom_attributes=CASE
                       WHEN EXCLUDED.custom_attributes IS NOT NULL
                       THEN contacts.custom_attributes || EXCLUDED.custom_attributes
                       ELSE contacts.custom_attributes
                     END,
                     updated_at=NOW()
               RETURNING id`,
              [brandId, email,
               c.name   || null,
               c.phone  || null,
               c.company|| null,
               c.custom_attributes ? JSON.stringify(c.custom_attributes) : null]
            );
            // Apply suppression status if contact is in suppression list
            await query(
              `UPDATE contacts SET status = (CASE WHEN s.reason='unsubscribe' THEN 'unsubscribed' WHEN s.reason='bounce' THEN 'bounced' WHEN s.reason='spam' THEN 'complained' ELSE 'suppressed' END)::contact_status
               FROM suppression s WHERE contacts.id=$1 AND contacts.email=s.email AND contacts.status='active'`,
              [rows[0].id]
            );
            if (list_id && rows[0].id) {
              await query(
                'INSERT INTO list_members (list_id, contact_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
                [list_id, rows[0].id]
              );
            }
            synced++;
          } catch (err) {
            failed++;
            errors.push({ index: i + idx, email, reason: err.message });
          }
        }));
      }

      const result = { ok: true, synced, failed };
      if (errors.length) result.errors = errors;
      return res.status(200).json(result);
    }

    // ── DELETE /api/sync — cancelar subscrição de emails ──
    if (req.method === 'DELETE') {
      const brandId = await resolveBrand(req, res);
      if (!brandId) return;

      const { emails } = req.body || {};
      if (!Array.isArray(emails) || !emails.length)
        return res.status(400).json({ error: 'Campo emails (array) obrigatório' });

      const valid = emails.map(e => (e||'').toLowerCase().trim()).filter(e => VALID_EMAIL.test(e));
      if (!valid.length) return res.status(400).json({ error: 'Nenhum email válido encontrado' });

      await query(
        `UPDATE contacts SET status='unsubscribed' WHERE brand_id=$1 AND email = ANY($2::text[]) AND status='active'`,
        [brandId, valid]
      );
      await query(
        `INSERT INTO suppression (email, reason) SELECT unnest($1::text[]), 'unsubscribe' ON CONFLICT (email) DO NOTHING`,
        [valid]
      );

      return res.status(200).json({ ok: true, unsubscribed: valid.length });
    }

    res.status(405).json({ error: 'Método não permitido' });
  } catch (err) {
    console.error('sync error:', err);
    res.status(500).json({ error: 'Erro de servidor' });
  }
};
