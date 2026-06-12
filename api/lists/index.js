const { query } = require('../../lib/db');
const { withAuth } = require('../../lib/auth');

// ── Segment rule builder ──────────────────────────────────────────────────────
const CONTACT_FIELDS = new Set(['name','email','phone','company','status']);

function buildSegmentWhere(rules, match) {
  const params = [];
  // +1 because list_id is always $1 in the outer query
  const next = (v) => { params.push(v); return `$${params.length + 1}`; };

  const conditions = (rules || []).map(rule => {
    const { field, field_type, operator, value } = rule;
    const fieldName = (field || '').trim();
    if (!fieldName) return null;

    let col;
    if (field_type === 'contact') {
      if (!CONTACT_FIELDS.has(fieldName)) return null;
      col = `c.${fieldName}`;
    } else {
      // Fully parameterised — safe for any field name including spaces
      col = `jsonb_extract_path_text(lm.extra_data, ${next(fieldName)})`;
    }

    if (operator === 'is_empty')     return `(${col} IS NULL OR ${col} = '')`;
    if (operator === 'is_not_empty') return `(${col} IS NOT NULL AND ${col} <> '')`;
    if (value === undefined || value === null || value === '') return null;

    switch (operator) {
      case 'equals':       return `${col} = ${next(value)}`;
      case 'not_equals':   return `${col} <> ${next(value)}`;
      case 'contains':     return `${col} ILIKE ${next('%'+value+'%')}`;
      case 'not_contains': return `${col} NOT ILIKE ${next('%'+value+'%')}`;
      case 'starts_with':  return `${col} ILIKE ${next(value+'%')}`;
      case 'ends_with':    return `${col} ILIKE ${next('%'+value)}`;
      case 'gt':           return `${col}::numeric > ${next(value)}`;
      case 'lt':           return `${col}::numeric < ${next(value)}`;
      case 'gte':          return `${col}::numeric >= ${next(value)}`;
      case 'lte':          return `${col}::numeric <= ${next(value)}`;
      case 'date_before':  return `${col}::date < ${next(value)}::date`;
      case 'date_after':   return `${col}::date > ${next(value)}::date`;
      default: return null;
    }
  }).filter(Boolean);

  if (!conditions.length) return { sql: 'TRUE', params };
  const op = match === 'any' ? ' OR ' : ' AND ';
  return { sql: `(${conditions.join(op)})`, params };
}

// As listas são globais (comuns a todas as marcas): o acesso exige apenas que
// o utilizador pertença a alguma marca. Os segmentos são por marca (brand_id).
async function hasAnyRole(userId) {
  const r = await query('SELECT 1 FROM user_brand_roles WHERE user_id=$1 LIMIT 1', [userId]);
  return !!r[0];
}

// ── Handler ───────────────────────────────────────────────────────────────────
module.exports = withAuth(async (req, res, user) => {
  const { id, brand_id, action, contact_id, segment_id, list_id } = req.query;

  // ── Segment single operations (?segment_id=X) ─────────────────────────────
  if (segment_id) {
    if (!await hasAnyRole(user.id)) return res.status(404).json({ error: 'Segmento não encontrado' });
    const auth = await query(`SELECT s.* FROM segments s WHERE s.id = $1`, [segment_id]);
    if (!auth[0]) return res.status(404).json({ error: 'Segmento não encontrado' });
    const seg = auth[0];

    try {
      if (req.method === 'GET') {
        if (action === 'count') {
          const { sql, params } = buildSegmentWhere(seg.rules, seg.match);
          const rows = await query(
            `SELECT COUNT(DISTINCT lm.contact_id)::int AS total
             FROM list_members lm
             JOIN contacts c ON c.id = lm.contact_id
             WHERE lm.list_id = $1 AND ${sql}`,
            [seg.list_id, ...params]
          );
          return res.status(200).json({ count: rows[0].total });
        }
        return res.status(200).json(seg);
      }

      if (req.method === 'PUT') {
        const { name, description, rules, match } = req.body || {};
        await query(
          `UPDATE segments SET name=COALESCE($1,name), description=$2,
           rules=COALESCE($3::jsonb,rules), match=COALESCE($4,match), updated_at=NOW()
           WHERE id=$5`,
          [name||null, description||null,
           rules !== undefined ? JSON.stringify(rules) : null,
           match||null, segment_id]
        );
        return res.status(200).json({ ok: true });
      }

      if (req.method === 'DELETE') {
        await query('DELETE FROM segments WHERE id=$1', [segment_id]);
        return res.status(200).json({ ok: true });
      }

      return res.status(405).json({ error: 'Método não permitido' });
    } catch (err) {
      console.error('segment error:', err?.message);
      return res.status(500).json({ error: 'Erro de servidor' });
    }
  }

  // ── Segment collection operations (?list_id=X&action=segments|segment_preview)
  if (list_id && action && (action === 'segments' || action === 'segment_preview')) {
    if (!await hasAnyRole(user.id)) return res.status(404).json({ error: 'Lista não encontrada' });
    const listAuth = await query(`SELECT l.* FROM lists l WHERE l.id = $1`, [list_id]);
    if (!listAuth[0]) return res.status(404).json({ error: 'Lista não encontrada' });

    try {
      if (action === 'segments' && req.method === 'GET') {
        // Segmentos são por marca: mostra apenas os da marca actual
        let segs;
        try {
          segs = await query(
            brand_id
              ? `SELECT s.id, s.name, s.description, s.rules, s.match, s.created_at
                 FROM segments s WHERE s.list_id = $1 AND (s.brand_id = $2 OR s.brand_id IS NULL) ORDER BY s.name`
              : `SELECT s.id, s.name, s.description, s.rules, s.match, s.created_at
                 FROM segments s WHERE s.list_id = $1 ORDER BY s.name`,
            brand_id ? [list_id, brand_id] : [list_id]
          );
        } catch (e) {
          if (e.code !== '42703') throw e; // migração 037 ainda não correu
          segs = await query(
            `SELECT s.id, s.name, s.description, s.rules, s.match, s.created_at
             FROM segments s WHERE s.list_id = $1 ORDER BY s.name`, [list_id]
          );
        }
        const withCounts = await Promise.all(segs.map(async s => {
          try {
            const { sql, params } = buildSegmentWhere(s.rules, s.match);
            const r = await query(
              `SELECT COUNT(DISTINCT lm.contact_id)::int AS total
               FROM list_members lm
               JOIN contacts c ON c.id = lm.contact_id
               WHERE lm.list_id = $1 AND ${sql}`,
              [list_id, ...params]
            );
            return { ...s, contact_count: r[0].total };
          } catch { return { ...s, contact_count: 0 }; }
        }));
        return res.status(200).json({ data: withCounts });
      }

      if (action === 'segments' && req.method === 'POST') {
        const { name, description, rules, match } = req.body || {};
        if (!name) return res.status(400).json({ error: 'Nome obrigatório' });
        const segBrand = brand_id || req.body?.brand_id || null;
        let rows;
        try {
          rows = await query(
            `INSERT INTO segments (list_id, name, description, rules, match, brand_id)
             VALUES ($1,$2,$3,$4::jsonb,$5,$6) RETURNING id`,
            [list_id, name, description||null, JSON.stringify(rules||[]), match||'all', segBrand]
          );
        } catch (e) {
          if (e.code !== '42703') throw e; // migração 037 ainda não correu
          rows = await query(
            `INSERT INTO segments (list_id, name, description, rules, match)
             VALUES ($1,$2,$3,$4::jsonb,$5) RETURNING id`,
            [list_id, name, description||null, JSON.stringify(rules||[]), match||'all']
          );
        }
        return res.status(201).json({ id: rows[0].id });
      }

      if (action === 'segment_preview' && req.method === 'POST') {
        const { rules, match } = req.body || {};
        const { sql, params } = buildSegmentWhere(rules, match || 'all');
        const rows = await query(
          `SELECT COUNT(DISTINCT lm.contact_id)::int AS total
           FROM list_members lm
           JOIN contacts c ON c.id = lm.contact_id
           WHERE lm.list_id = $1 AND ${sql}`,
          [list_id, ...params]
        );
        return res.status(200).json({ count: rows[0].total });
      }

      return res.status(405).json({ error: 'Método não permitido' });
    } catch (err) {
      console.error('segment collection error:', err?.message);
      return res.status(500).json({ error: 'Erro de servidor' });
    }
  }

  // ── List single operations (?id=X) ────────────────────────────────────────
  if (id) {
    if (!await hasAnyRole(user.id)) return res.status(404).json({ error: 'Lista não encontrada' });
    const auth = await query(`SELECT l.* FROM lists l WHERE l.id = $1`, [id]);
    if (!auth[0]) return res.status(404).json({ error: 'Lista não encontrada' });

    try {
      if (req.method === 'GET') {
        const rows = await query(
          `SELECT l.*, b.name AS brand_name,
                  COUNT(lm.contact_id)::int AS total_contacts,
                  COUNT(lm.contact_id) FILTER (WHERE c.brand_id = $2)::int AS total_contacts_in_brand
           FROM lists l
           LEFT JOIN brands b ON b.id = l.brand_id
           LEFT JOIN list_members lm ON lm.list_id = l.id
           LEFT JOIN contacts c ON c.id = lm.contact_id
           WHERE l.id = $1 GROUP BY l.id, b.name`,
          [id, brand_id || auth[0].brand_id]
        );
        return res.status(200).json(rows[0]);
      }

      if (req.method === 'PUT') {
        if (action === 'update_member_data') {
          const { contact_id: cid, extra_data } = req.body || {};
          if (!cid) return res.status(400).json({ error: 'contact_id obrigatório' });
          await query(
            'UPDATE list_members SET extra_data=$1::jsonb WHERE list_id=$2 AND contact_id=$3',
            [JSON.stringify(extra_data || {}), id, cid]
          );
          return res.status(200).json({ ok: true });
        }
        // Listas fixas (Marketing/Colaboradores): o nome não pode ser alterado
        const { description, extra_fields } = req.body || {};
        await query(
          `UPDATE lists SET description=$1,
           extra_fields=COALESCE($2::jsonb,extra_fields) WHERE id=$3`,
          [description||null,
           extra_fields !== undefined ? JSON.stringify(extra_fields) : null, id]
        );
        return res.status(200).json({ ok: true });
      }

      if (req.method === 'DELETE') {
        if (action === 'remove_contact' && contact_id) {
          await query('DELETE FROM list_members WHERE list_id=$1 AND contact_id=$2', [id, contact_id]);
          return res.status(200).json({ ok: true });
        }
        // As duas listas são fixas e comuns a todas as marcas — não podem ser apagadas
        return res.status(403).json({ error: 'As listas Marketing e Colaboradores são fixas e não podem ser apagadas.' });
      }

      if (req.method === 'POST' && action === 'add_contact') {
        const { contact_id: cid, extra_data } = req.body || {};
        if (!cid) return res.status(400).json({ error: 'contact_id obrigatório' });
        await query(
          'INSERT INTO list_members (list_id, contact_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [id, cid]
        );
        if (extra_data && typeof extra_data === 'object' && Object.keys(extra_data).length) {
          await query(
            'UPDATE list_members SET extra_data=$1::jsonb WHERE list_id=$2 AND contact_id=$3',
            [JSON.stringify(extra_data), id, cid]
          );
        }
        return res.status(200).json({ ok: true });
      }

      return res.status(405).json({ error: 'Método não permitido' });
    } catch (err) {
      return res.status(500).json({ error: 'Erro de servidor' });
    }
  }

  // ── List collection operations (?brand_id=X) ─────────────────────────────
  if (!brand_id) return res.status(400).json({ error: 'brand_id obrigatório' });

  // Listas globais — as mesmas duas listas para todas as marcas. Deduplica por
  // nome (menor id) para instalações onde a migração 037 ainda não correu.
  const listQuery = `
    SELECT DISTINCT ON (l.name)
           l.id, l.name, l.description, l.created_at, l.extra_fields,
           (SELECT COUNT(*)::int FROM list_members lm WHERE lm.list_id = l.id) AS total_contacts
    FROM lists l
    WHERE l.name IN ('Marketing','Colaboradores')
    ORDER BY l.name, l.id`;

  try {
    if (!await hasAnyRole(user.id)) return res.status(403).json({ error: 'Sem permissão' });
    if (req.method === 'GET') {
      let rows = await query(listQuery);
      // Auto-criar as duas listas fixas se ainda não existirem
      if (rows.length < 2) {
        const defaults = [
          ['Marketing',     'Lista principal de marketing'],
          ['Colaboradores', 'Lista de colaboradores internos'],
        ];
        for (const [name, description] of defaults) {
          if (rows.some(r => r.name === name)) continue;
          try {
            await query(
              'INSERT INTO lists (brand_id, name, description) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
              [brand_id, name, description]
            );
          } catch (_) {}
        }
        rows = await query(listQuery);
      }
      return res.status(200).json({ data: rows });
    }

    if (req.method === 'POST') {
      // Só existem as duas listas fixas — não é possível criar novas
      return res.status(403).json({ error: 'Só existem as listas Marketing e Colaboradores, comuns a todas as marcas.' });
    }

    res.status(405).json({ error: 'Método não permitido' });
  } catch (err) {
    res.status(500).json({ error: 'Erro de servidor' });
  }
});
