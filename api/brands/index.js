const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
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

  const { id, action, member_id, block_id, media_id, type } = req.query;

  try {
    if (req.method === 'GET') {
      if (id && action === 'media') {
        try {
          const rows = await query(
            `SELECT id, brand_id, name, url, mime_type, is_shared, created_at, updated_at
             FROM media WHERE brand_id=$1 OR is_shared=TRUE ORDER BY created_at DESC`,
            [id]
          );
          return res.status(200).json({ data: rows });
        } catch (e) {
          if (e.code === '42P01') return res.status(200).json({ data: [], _migration_pending: true });
          throw e;
        }
      }
      if (id && action === 'blocks') {
        try {
          const params = [id];
          let where = 'WHERE brand_id=$1';
          if (type) { params.push(type); where += ` AND type=$${params.length}`; }
          const rows = await query(
            `SELECT id, brand_id, type, name, html_content, created_at, updated_at
             FROM brand_blocks ${where} ORDER BY type, name`,
            params
          );
          return res.status(200).json({ data: rows });
        } catch (e) {
          if (e.code === '42P01') return res.status(200).json({ data: [], _migration_pending: true });
          throw e;
        }
      }
      if (id && action === 'block' && block_id) {
        try {
          const rows = await query(
            `SELECT id, brand_id, type, name, html_content, created_at, updated_at
             FROM brand_blocks WHERE id=$1 AND brand_id=$2`,
            [block_id, id]
          );
          if (!rows[0]) return res.status(404).json({ error: 'Bloco não encontrado' });
          return res.status(200).json(rows[0]);
        } catch (e) {
          if (e.code === '42P01') return res.status(503).json({ error: 'Tabela brand_blocks não existe — corre a migração 007_brand_blocks_multi.sql no Supabase.' });
          throw e;
        }
      }
      if (id && action === 'team') {
        const rows = await query(
          `SELECT u.id, u.name, u.email, u.active, u.last_login, ubr.role
           FROM user_brand_roles ubr JOIN users u ON u.id = ubr.user_id
           WHERE ubr.brand_id = $1 ORDER BY u.name`,
          [id]
        );
        return res.status(200).json({ data: rows });
      }
      if (id && action === 'permissions' && member_id) {
        try {
          const [areas, roleRow] = await Promise.all([
            query('SELECT area FROM user_brand_areas WHERE user_id=$1 AND brand_id=$2', [member_id, id]),
            query('SELECT role FROM user_brand_roles WHERE user_id=$1 AND brand_id=$2', [member_id, id]),
          ]);
          const role = roleRow[0]?.role || 'viewer';
          // empty areas = full access (no restrictions configured)
          return res.status(200).json({ areas: areas.map(r => r.area), restricted: areas.length > 0, role });
        } catch (e) {
          if (e.code === '42P01') return res.status(200).json({ areas: [], restricted: false, role: 'viewer', _migration_pending: true });
          throw e;
        }
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

    if (req.method === 'POST' && id && action === 'block') {
      const { type: bType, name, html_content } = req.body || {};
      if (!['header','footer'].includes(bType)) return res.status(400).json({ error: 'type deve ser header ou footer' });
      if (!name) return res.status(400).json({ error: 'name obrigatório' });
      try {
        const r = await query(
          `INSERT INTO brand_blocks (brand_id, type, name, html_content) VALUES ($1,$2,$3,$4)
           RETURNING id, brand_id, type, name, html_content, created_at, updated_at`,
          [id, bType, name, html_content || null]
        );
        return res.status(201).json(r[0]);
      } catch (e) {
        if (e.code === '42P01') return res.status(503).json({ error: 'Migração em falta: corre 007_brand_blocks_multi.sql no Supabase para activar os blocos.' });
        throw e;
      }
    }

    if (req.method === 'PUT' && id && action === 'block' && block_id) {
      const body = req.body || {};
      const sets = [];
      const params = [];
      for (const f of ['name','html_content','type']) {
        if (Object.prototype.hasOwnProperty.call(body, f)) {
          params.push(body[f] === '' ? null : body[f]);
          sets.push(`${f}=$${params.length}`);
        }
      }
      if (!sets.length) return res.status(200).json({ ok: true });
      sets.push(`updated_at=NOW()`);
      params.push(block_id);
      params.push(id);
      try {
        await query(
          `UPDATE brand_blocks SET ${sets.join(', ')} WHERE id=$${params.length-1} AND brand_id=$${params.length}`,
          params
        );
        return res.status(200).json({ ok: true });
      } catch (e) {
        if (e.code === '42P01') return res.status(503).json({ error: 'Migração em falta: corre 007_brand_blocks_multi.sql no Supabase.' });
        throw e;
      }
    }

    if (req.method === 'DELETE' && id && action === 'block' && block_id) {
      try {
        await query('DELETE FROM brand_blocks WHERE id=$1 AND brand_id=$2', [block_id, id]);
        return res.status(200).json({ ok: true });
      } catch (e) {
        if (e.code === '42P01') return res.status(503).json({ error: 'Migração em falta: corre 007_brand_blocks_multi.sql no Supabase.' });
        throw e;
      }
    }

    if (req.method === 'POST' && id && action === 'media') {
      const { name, url, mime_type, is_shared } = req.body || {};
      if (!name || !url) return res.status(400).json({ error: 'name e url obrigatórios' });
      try {
        const r = await query(
          `INSERT INTO media (brand_id, name, url, mime_type, is_shared, created_by)
           VALUES ($1,$2,$3,$4,$5,$6)
           RETURNING id, brand_id, name, url, mime_type, is_shared, created_at, updated_at`,
          [id, name, url, mime_type || null, !!is_shared, user.id]
        );
        return res.status(201).json(r[0]);
      } catch (e) {
        if (e.code === '42P01') return res.status(503).json({ error: 'Migração em falta: corre 008_media.sql no Supabase.' });
        throw e;
      }
    }

    if (req.method === 'PUT' && action === 'media' && media_id) {
      const body = req.body || {};
      const sets = [];
      const params = [];
      for (const f of ['name', 'is_shared']) {
        if (Object.prototype.hasOwnProperty.call(body, f)) {
          params.push(body[f]);
          sets.push(`${f}=$${params.length}`);
        }
      }
      if (!sets.length) return res.status(200).json({ ok: true });
      sets.push(`updated_at=NOW()`);
      params.push(media_id);
      params.push(user.id);
      try {
        const r = await query(
          `UPDATE media SET ${sets.join(', ')}
           WHERE id=$${params.length-1}
             AND brand_id IN (SELECT brand_id FROM user_brand_roles WHERE user_id=$${params.length})`,
          params
        );
        return res.status(200).json({ ok: true });
      } catch (e) {
        if (e.code === '42P01') return res.status(503).json({ error: 'Migração em falta: corre 008_media.sql no Supabase.' });
        throw e;
      }
    }

    if (req.method === 'DELETE' && action === 'media' && media_id) {
      try {
        await query(
          `DELETE FROM media
           WHERE id=$1
             AND brand_id IN (SELECT brand_id FROM user_brand_roles WHERE user_id=$2)`,
          [media_id, user.id]
        );
        return res.status(200).json({ ok: true });
      } catch (e) {
        if (e.code === '42P01') return res.status(503).json({ error: 'Migração em falta: corre 008_media.sql no Supabase.' });
        throw e;
      }
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

      // Send welcome email (best-effort — never blocks the response)
      if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
        try {
          const brandRows = await query('SELECT name FROM brands WHERE id=$1', [id]);
          const brandName = brandRows[0]?.name || id;
          const roleLabel = { owner: 'Owner', admin: 'Admin', editor: 'Editor', viewer: 'Marketing Account' };
          const port = parseInt(process.env.SMTP_PORT || '587', 10);
          const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST, port, secure: port === 465,
            auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
          });
          const fromDomain = process.env.SMTP_FROM_DOMAIN || 'caetano.pt';
          await transporter.sendMail({
            from: `"PrimeMail" <noreply@${fromDomain}>`,
            to: email.toLowerCase().trim(),
            subject: `Foste adicionado à equipa ${brandName} no PrimeMail`,
            html: `<p>Olá ${name},</p>
<p>Foste adicionado à marca <strong>${brandName}</strong> no PrimeMail com a função <strong>${roleLabel[safeRole] || safeRole}</strong>.</p>
<p>Podes aceder à plataforma em <a href="https://${fromDomain}">PrimeMail</a> com o teu email e a password definida pelo administrador.</p>
<p>Bem-vindo à equipa!</p>`,
            text: `Olá ${name},\n\nForam adicionado à marca ${brandName} no PrimeMail com a função ${roleLabel[safeRole] || safeRole}.\n\nBem-vindo à equipa!`,
          });
        } catch (mailErr) {
          console.error('invite email error:', mailErr.message);
        }
      }

      return res.status(201).json({ ok: true, user_id: userId });
    }

    if (req.method === 'PUT' && id && action === 'update_role' && member_id) {
      if (!await isAdmin(user.id, id)) return res.status(403).json({ error: 'Sem permissão' });
      const { role } = req.body || {};
      if (!['owner','admin','editor','viewer'].includes(role)) return res.status(400).json({ error: 'role inválido' });
      await query('UPDATE user_brand_roles SET role=$1 WHERE user_id=$2 AND brand_id=$3', [role, member_id, id]);
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'PUT' && id && action === 'permissions' && member_id) {
      if (!await isAdmin(user.id, id)) return res.status(403).json({ error: 'Sem permissão' });
      const { areas, restricted } = req.body || {};
      try {
        await query('DELETE FROM user_brand_areas WHERE user_id=$1 AND brand_id=$2', [member_id, id]);
        // restricted=false (or omitted) means full access -> no rows.
        if (restricted && Array.isArray(areas) && areas.length) {
          const safeAreas = areas.filter(a => typeof a === 'string' && /^[a-zA-Z]+$/.test(a));
          if (safeAreas.length) {
            const vals = safeAreas.map((_, i) => `($1,$2,$${i + 3})`).join(',');
            await query(
              `INSERT INTO user_brand_areas (user_id, brand_id, area) VALUES ${vals} ON CONFLICT DO NOTHING`,
              [member_id, id, ...safeAreas]
            );
          }
        }
        return res.status(200).json({ ok: true });
      } catch (e) {
        if (e.code === '42P01') return res.status(503).json({ error: 'Migração em falta: corre 010_user_brand_areas.sql.' });
        throw e;
      }
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
      const body = req.body || {};
      const fields = ['name','color','logo_url','from_name','from_email','reply_to','header_html','footer_html'];
      const sets = [];
      const params = [];
      for (const f of fields) {
        if (Object.prototype.hasOwnProperty.call(body, f)) {
          params.push(body[f] === '' ? null : body[f]);
          sets.push(`${f}=$${params.length}`);
        }
      }
      if (Object.prototype.hasOwnProperty.call(body, 'variables')) {
        params.push(body.variables ? JSON.stringify(body.variables) : null);
        sets.push(`variables=$${params.length}`);
      }
      if (!sets.length) return res.status(200).json({ ok: true });
      params.push(id);
      await query(`UPDATE brands SET ${sets.join(', ')} WHERE id=$${params.length}`, params);
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: 'Método não permitido' });
  } catch (err) {
    res.status(500).json({ error: 'Erro de servidor', detail: err.message });
  }
};
