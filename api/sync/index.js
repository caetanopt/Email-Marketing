const { query } = require('../../lib/db');
const { cors } = require('../../lib/auth');
const { upsertContactos, aplicarSupressao } = require('../../lib/contactos');
const { rateLimit, clientIp } = require('../../lib/ratelimit');
const crypto = require('crypto');

const VALID_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Autenticação por Authorization: Bearer <api_key>. São aceites dois tipos de
// chave, com o mesmo efeito:
//   1. Chave global (pmg_…)
//   2. Chave de uma marca (pm_…), lida de brands.api_key
//
// Os contactos e as listas são globais — não pertencem a nenhuma marca — por
// isso a chave só serve para autenticar: já não escolhe onde os contactos
// ficam. O brand_id continua a ser aceite no pedido (as integrações antigas
// enviam-no) mas é ignorado.
async function autenticar(req, res) {
  const auth = (req.headers.authorization || '').trim();
  if (!auth.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authorization header obrigatório: Bearer <api_key>' });
    return false;
  }
  const key = auth.slice(7).trim();
  // S-6: as chaves são guardadas como hash. Aceita-se o hash e, durante a
  // transição, o texto claro que ainda exista (chaves antigas por regenerar).
  const hash = crypto.createHash('sha256').update(key).digest('hex');

  try {
    const gs = await query('SELECT global_api_key, global_api_key_hash FROM global_settings WHERE id=1');
    if (gs[0]) {
      if (gs[0].global_api_key_hash && gs[0].global_api_key_hash === hash) return true;
      if (gs[0].global_api_key && gs[0].global_api_key === key) return true;   // legado
    }
  } catch (e) {
    if (e.code !== '42703' && e.code !== '42P01') throw e;
    // coluna do hash ainda não existe — tentar só o texto claro
    try {
      const gs = await query('SELECT global_api_key FROM global_settings WHERE id=1');
      if (gs[0]?.global_api_key && gs[0].global_api_key === key) return true;
    } catch (_) {}
  }

  try {
    const rows = await query('SELECT id FROM brands WHERE api_key_hash=$1 OR api_key=$2', [hash, key]);
    if (rows[0]) return true;
  } catch (e) {
    if (e.code !== '42703') throw e;
    const rows = await query('SELECT id FROM brands WHERE api_key=$1', [key]);   // schema antigo
    if (rows[0]) return true;
  }
  res.status(401).json({ error: 'API key inválida' }); return false;
}

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;

  // S-5: API pública. Limita por IP antes de autenticar, para travar tanto
  // tentativas de adivinhar chaves como abuso de uma integração. Generoso para
  // não estorvar sincronizações legítimas: 600 pedidos/minuto por IP.
  const rl = await rateLimit('sync', 'ip:' + clientIp(req), 600, 60);
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfter));
    return res.status(429).json({ error: 'Demasiados pedidos. Tenta mais tarde.' });
  }

  try {
    // ── GET /api/sync?email=xxx — consultar estado de um contacto ──
    if (req.method === 'GET') {
      if (!await autenticar(req, res)) return;

      const { email } = req.query;
      if (!email) return res.status(400).json({ error: 'Parâmetro email obrigatório' });
      const e = email.toLowerCase().trim();

      const rows = await query(
        `SELECT c.id, c.email, c.name, c.phone, c.company, c.status, c.custom_attributes, c.created_at,
                COALESCE(
                  json_agg(json_build_object(
                    'list_id', lm.list_id,
                    'list_name', l.name,
                    'extra_data', lm.extra_data
                  )) FILTER (WHERE lm.list_id IS NOT NULL), '[]'
                ) AS lists
         FROM contacts c
         LEFT JOIN list_members lm ON lm.contact_id = c.id
         LEFT JOIN lists l ON l.id = lm.list_id
         WHERE LOWER(c.email)=$1
         GROUP BY c.id
         ORDER BY c.id
         LIMIT 1`,
        [e]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Contacto não encontrado' });
      return res.status(200).json(rows[0]);
    }

    // ── POST /api/sync — sincronizar (upsert) contactos ──
    if (req.method === 'POST') {
      if (!await autenticar(req, res)) return;

      const { contacts, list_id } = req.body || {};
      if (!Array.isArray(contacts) || !contacts.length)
        return res.status(400).json({ error: 'Campo contacts (array) obrigatório' });

      if (contacts.length > 1000)
        return res.status(400).json({ error: 'Máximo de 1000 contactos por pedido' });

      // As listas são globais (migração 037) e os contactos também (051): só
      // se confirma que a lista existe.
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
            const extraData = (c.extra_data && typeof c.extra_data === 'object' && !Array.isArray(c.extra_data))
              ? c.extra_data : null;
            const [contacto] = await upsertContactos(query, [{
              email,
              name: c.name || null,
              phone: c.phone || null,
              company: c.company || null,
              source: 'api',
              custom_attributes: c.custom_attributes || null,
            }], { fundirAtributos: true });
            if (!contacto?.id) throw new Error('Contacto não gravado');
            // Apply suppression status if contact is in suppression list
            await aplicarSupressao(query, [contacto.id]);
            if (list_id) {
              await query(
                `INSERT INTO list_members (list_id, contact_id, extra_data)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (list_id, contact_id) DO UPDATE
                   SET extra_data = CASE
                     WHEN EXCLUDED.extra_data IS NOT NULL
                     THEN COALESCE(list_members.extra_data, '{}'::jsonb) || EXCLUDED.extra_data
                     ELSE list_members.extra_data
                   END`,
                [list_id, contacto.id, extraData ? JSON.stringify(extraData) : null]
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
      if (!await autenticar(req, res)) return;

      const { emails, list_id } = req.body || {};
      if (!Array.isArray(emails) || !emails.length)
        return res.status(400).json({ error: 'Campo emails (array) obrigatório' });

      const valid = emails.map(e => (e||'').toLowerCase().trim()).filter(e => VALID_EMAIL.test(e));
      if (!valid.length) return res.status(400).json({ error: 'Nenhum email válido encontrado' });

      // Com list_id: sai só daquela lista e continua a receber das outras. É
      // uma remoção da lista, não uma supressão — o email NÃO entra na lista
      // de supressão, senão deixava de receber tudo.
      if (list_id) {
        const listRows = await query('SELECT id, name FROM lists WHERE id=$1', [list_id]);
        if (!listRows[0]) return res.status(404).json({ error: 'Lista não encontrada' });
        const removidos = await query(
          `DELETE FROM list_members
           WHERE list_id=$1
             AND contact_id IN (SELECT id FROM contacts WHERE LOWER(email) = ANY($2::text[]))
           RETURNING contact_id`,
          [list_id, valid]
        );
        return res.status(200).json({
          ok: true, scope: 'lista', list_id: Number(list_id), list_name: listRows[0].name,
          removed: removidos.length,
        });
      }

      // Sem list_id: cancelamento total. O email entra na lista de supressão,
      // que é global, e deixa de receber de qualquer lista e de qualquer
      // marca — é o mesmo efeito do link de cancelamento nos emails.
      await query(
        `UPDATE contacts SET status='unsubscribed', updated_at=NOW()
         WHERE LOWER(email) = ANY($1::text[]) AND status='active'`,
        [valid]
      );
      await query(
        `INSERT INTO suppression (email, reason) SELECT unnest($1::text[]), 'unsubscribe' ON CONFLICT (email) DO NOTHING`,
        [valid]
      );

      return res.status(200).json({ ok: true, scope: 'global', unsubscribed: valid.length });
    }

    res.status(405).json({ error: 'Método não permitido' });
  } catch (err) {
    console.error('sync error:', err);
    res.status(500).json({ error: 'Erro de servidor' });
  }
};
