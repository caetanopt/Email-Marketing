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

// ── Handler ───────────────────────────────────────────────────────────────────
module.exports = withAuth(async (req, res, user) => {
  const { id, brand_id, action, contact_id, segment_id, list_id } = req.query;

  // ── Segment single operations (?segment_id=X) ─────────────────────────────
  if (segment_id) {
    const auth = await query(
      `SELECT s.*, l.brand_id FROM segments s
       JOIN lists l ON l.id = s.list_id
       JOIN user_brand_roles ubr ON ubr.brand_id = l.brand_id AND ubr.user_id = $2
       WHERE s.id = $1`,
      [segment_id, user.id]
    );
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
    const listAuth = await query(
      `SELECT l.* FROM lists l
       JOIN user_brand_roles ubr ON ubr.brand_id = l.brand_id AND ubr.user_id = $2
       WHERE l.id = $1`,
      [list_id, user.id]
    );
    if (!listAuth[0]) return res.status(404).json({ error: 'Lista não encontrada' });

    try {
      if (action === 'segments' && req.method === 'GET') {
        const segs = await query(
          `SELECT s.id, s.name, s.description, s.rules, s.match, s.created_at
           FROM segments s WHERE s.list_id = $1 ORDER BY s.name`,
          [list_id]
        );
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

      if (action === 'segments' && req.method === 'POST') {
        const { name, description, rules, match } = req.body || {};
        if (!name) return res.status(400).json({ error: 'Nome obrigatório' });
        const rows = await query(
          `INSERT INTO segments (list_id, name, description, rules, match)
           VALUES ($1,$2,$3,$4::jsonb,$5) RETURNING id`,
          [list_id, name, description||null, JSON.stringify(rules||[]), match||'all']
        );
        return res.status(201).json({ id: rows[0].id });
      }

      if (action === 'segment_preview' && req.method === 'POST') {
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

      return res.status(405).json({ error: 'Método não permitido' });
    } catch (err) {
      console.error('segment collection error:', err?.message);
      return res.status(500).json({ error: 'Erro de servidor' });
    }
  }

  // ── List single operations (?id=X) ────────────────────────────────────────
  if (id) {
    const auth = await query(
      `SELECT l.* FROM lists l
       JOIN user_brand_roles ubr ON ubr.brand_id = l.brand_id AND ubr.user_id = $2
       WHERE l.id = $1`,
      [id, user.id]
    );
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
        const { name, description, extra_fields } = req.body || {};
        await query(
          `UPDATE lists SET name=COALESCE($1,name), description=$2,
           extra_fields=COALESCE($3::jsonb,extra_fields) WHERE id=$4`,
          [name||null, description||null,
           extra_fields !== undefined ? JSON.stringify(extra_fields) : null, id]
        );
        return res.status(200).json({ ok: true });
      }

      if (req.method === 'DELETE') {
        if (action === 'remove_contact' && contact_id) {
          await query('DELETE FROM list_members WHERE list_id=$1 AND contact_id=$2', [id, contact_id]);
          return res.status(200).json({ ok: true });
        }
        await query('DELETE FROM lists WHERE id=$1', [id]);
        return res.status(200).json({ ok: true });
      }

      if (req.method === 'POST' && action === 'add_contact') {
        const { contact_id: cid } = req.body || {};
        if (!cid) return res.status(400).json({ error: 'contact_id obrigatório' });
        await query(
          'INSERT INTO list_members (list_id, contact_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [id, cid]
        );
        return res.status(200).json({ ok: true });
      }

      return res.status(405).json({ error: 'Método não permitido' });
    } catch (err) {
      return res.status(500).json({ error: 'Erro de servidor' });
    }
  }

  // ── List collection operations (?brand_id=X) ─────────────────────────────
  if (!brand_id) return res.status(400).json({ error: 'brand_id obrigatório' });

  try {
    if (req.method === 'GET') {
      let rows = await query(
        `SELECT l.id, l.name, l.description, l.created_at, l.extra_fields,
                COUNT(lm.contact_id)::int AS total_contacts
         FROM lists l
         JOIN user_brand_roles ubr ON ubr.brand_id = l.brand_id AND ubr.user_id = $2
         LEFT JOIN list_members lm ON lm.list_id = l.id
         WHERE l.brand_id = $1
         GROUP BY l.id ORDER BY l.name`,
        [brand_id, user.id]
      );
      // Auto-create the two default lists if brand has none
      if (rows.length === 0) {
        const defaults = [
          ['Marketing',     'Lista principal de marketing'],
          ['Colaboradores', 'Lista de colaboradores internos'],
        ];
        for (const [name, description] of defaults) {
          try {
            await query(
              'INSERT INTO lists (brand_id, name, description) VALUES ($1,$2,$3) ON CONFLICT (brand_id, name) DO NOTHING',
              [brand_id, name, description]
            );
          } catch (_) {}
        }
        rows = await query(
          `SELECT l.id, l.name, l.description, l.created_at, l.extra_fields,
                  COUNT(lm.contact_id)::int AS total_contacts
           FROM lists l
           JOIN user_brand_roles ubr ON ubr.brand_id = l.brand_id AND ubr.user_id = $2
           LEFT JOIN list_members lm ON lm.list_id = l.id
           WHERE l.brand_id = $1
           GROUP BY l.id ORDER BY l.name`,
          [brand_id, user.id]
        );
      }
      return res.status(200).json({ data: rows });
    }

    if (req.method === 'POST') {
      const { name, description } = req.body || {};
      if (!name) return res.status(400).json({ error: 'Nome obrigatório' });
      const rows = await query(
        'INSERT INTO lists (brand_id, name, description) VALUES ($1,$2,$3) RETURNING id',
        [brand_id, name, description||null]
      );
      return res.status(201).json({ id: rows[0].id, name });
    }

    res.status(405).json({ error: 'Método não permitido' });
  } catch (err) {
    res.status(500).json({ error: 'Erro de servidor' });
  }
});
