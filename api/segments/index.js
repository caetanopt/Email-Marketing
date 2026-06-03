const { query } = require('../../lib/db');
const { withAuth } = require('../../lib/auth');

const CONTACT_FIELDS = new Set(['name','email','phone','company','status']);

// Builds WHERE SQL fragment from rules. list_id is always $1 in the outer query.
function buildSegmentWhere(rules, match) {
  const params = [];
  const next = (v) => { params.push(v); return `$${params.length + 1}`; }; // +1 offset for list_id=$1

  const conditions = (rules || []).map(rule => {
    const { field, field_type, operator, value } = rule;
    const safeField = (field || '').replace(/[^a-zA-Z0-9_]/g, '');
    if (!safeField) return null;

    let col;
    if (field_type === 'contact') {
      if (!CONTACT_FIELDS.has(field)) return null;
      col = `c.${field}`;
    } else {
      col = `(lm.extra_data->>'${safeField}')`;
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

module.exports = withAuth(async (req, res, user) => {
  const { id, list_id, action } = req.query;

  try {
    // ── Single-segment operations ──────────────────────────
    if (id) {
      // Verify ownership: segment's list must belong to a brand the user has access to
      const auth = await query(
        `SELECT s.*, l.brand_id FROM segments s
         JOIN lists l ON l.id = s.list_id
         JOIN user_brand_roles ubr ON ubr.brand_id = l.brand_id AND ubr.user_id = $2
         WHERE s.id = $1`,
        [id, user.id]
      );
      if (!auth[0]) return res.status(404).json({ error: 'Segmento não encontrado' });
      const seg = auth[0];

      if (req.method === 'GET') {
        if (action === 'count') {
          const { sql, params } = buildSegmentWhere(seg.rules, seg.match);
          const rows = await query(
            `SELECT COUNT(DISTINCT lm.contact_id)::int AS total
             FROM list_members lm
             JOIN contacts c ON c.id = lm.contact_id
             WHERE lm.list_id = $1 AND c.status NOT IN ('unsubscribed','bounced','complained') AND ${sql}`,
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
           match||null, id]
        );
        return res.status(200).json({ ok: true });
      }

      if (req.method === 'DELETE') {
        await query('DELETE FROM segments WHERE id=$1', [id]);
        return res.status(200).json({ ok: true });
      }

      return res.status(405).json({ error: 'Método não permitido' });
    }

    // ── Collection operations (need list_id) ──────────────
    if (!list_id) return res.status(400).json({ error: 'list_id obrigatório' });

    // Verify list ownership
    const listAuth = await query(
      `SELECT l.* FROM lists l
       JOIN user_brand_roles ubr ON ubr.brand_id = l.brand_id AND ubr.user_id = $2
       WHERE l.id = $1`,
      [list_id, user.id]
    );
    if (!listAuth[0]) return res.status(404).json({ error: 'Lista não encontrada' });

    if (req.method === 'GET') {
      // List all segments with contact counts
      const segs = await query(
        `SELECT s.id, s.name, s.description, s.rules, s.match, s.created_at
         FROM segments s WHERE s.list_id = $1 ORDER BY s.name`,
        [list_id]
      );
      // Compute counts in parallel
      const withCounts = await Promise.all(segs.map(async s => {
        try {
          const { sql, params } = buildSegmentWhere(s.rules, s.match);
          const r = await query(
            `SELECT COUNT(DISTINCT lm.contact_id)::int AS total
             FROM list_members lm
             JOIN contacts c ON c.id = lm.contact_id
             WHERE lm.list_id = $1 AND c.status NOT IN ('unsubscribed','bounced','complained') AND ${sql}`,
            [list_id, ...params]
          );
          return { ...s, contact_count: r[0].total };
        } catch { return { ...s, contact_count: 0 }; }
      }));
      return res.status(200).json({ data: withCounts });
    }

    if (req.method === 'POST') {
      if (action === 'preview') {
        // Count contacts matching rules (for live preview while building)
        const { rules, match } = req.body || {};
        const { sql, params } = buildSegmentWhere(rules, match || 'all');
        const rows = await query(
          `SELECT COUNT(DISTINCT lm.contact_id)::int AS total
           FROM list_members lm
           JOIN contacts c ON c.id = lm.contact_id
           WHERE lm.list_id = $1 AND c.status NOT IN ('unsubscribed','bounced','complained') AND ${sql}`,
          [list_id, ...params]
        );
        return res.status(200).json({ count: rows[0].total });
      }

      const { name, description, rules, match } = req.body || {};
      if (!name) return res.status(400).json({ error: 'Nome obrigatório' });
      const rows = await query(
        `INSERT INTO segments (list_id, name, description, rules, match)
         VALUES ($1,$2,$3,$4::jsonb,$5) RETURNING id`,
        [list_id, name, description||null, JSON.stringify(rules||[]), match||'all']
      );
      return res.status(201).json({ id: rows[0].id });
    }

    return res.status(405).json({ error: 'Método não permitido' });
  } catch (err) {
    console.error('segments error:', err?.message);
    return res.status(500).json({ error: 'Erro de servidor' });
  }
});
