const bcrypt = require('bcryptjs');
const { SendEmailCommand } = require('@aws-sdk/client-ses');
const dns = require('dns').promises;
const crypto = require('crypto');
const { query } = require('../../lib/db');
const { put } = require('@vercel/blob');
const { getSESClient } = require('../../lib/ses');
const { requireAuth, cors } = require('../../lib/auth');

// ── DNS health check (SPF / DKIM / DMARC) ──────────────────────
const DNS_TIMEOUT_MS = 3000;
function withDnsTimeout(promise) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('DNS timeout')), DNS_TIMEOUT_MS)),
  ]);
}

async function checkDnsRecord(domain) {
  async function resolveTxt(host) {
    try { return await withDnsTimeout(dns.resolveTxt(host)); } catch { return []; }
  }
  async function resolveCname(host) {
    try { return await withDnsTimeout(dns.resolveCname(host)); } catch { return []; }
  }

  // SPF — look for v=spf1 in TXT records of the domain
  const spfTxt = await resolveTxt(domain);
  const spfRecord = spfTxt.flat().find(r => r.startsWith('v=spf1'));

  // DKIM — AWS SES Easy DKIM uses 3 random-selector CNAME records.
  // Ask SES for the tokens, then confirm the CNAMEs resolve in DNS.
  let dkimRecord = null;
  let dkimOk = false;

  try {
    const { GetIdentityDkimAttributesCommand } = require('@aws-sdk/client-ses');
    const { DkimAttributes } = await getSESClient().send(
      new GetIdentityDkimAttributesCommand({ Identities: [domain] })
    );
    const attrs = DkimAttributes?.[domain];
    const tokens = attrs?.DkimTokens || [];
    if (tokens.length) {
      if (attrs.DkimVerificationStatus === 'Success') {
        // Confirm first CNAME is live in DNS
        const cnameHost = `${tokens[0]}._domainkey.${domain}`;
        const cnames = await resolveCname(cnameHost);
        dkimRecord = cnames[0] || `${tokens[0]}.dkim.amazonses.com`;
        dkimOk = true;
      } else {
        // SES issued tokens but CNAMEs not yet created/propagated
        dkimRecord = `${tokens[0]}._domainkey.${domain} → ${tokens[0]}.dkim.amazonses.com`;
        dkimOk = false;
      }
    }
  } catch (_) {}

  // Fallback: TXT-based DKIM (non-SES or missing AWS credentials)
  if (!dkimOk && !dkimRecord) {
    for (const selector of ['mail', 'ses', 'amazonses', 'default']) {
      const recs = await resolveTxt(`${selector}._domainkey.${domain}`);
      const found = recs.flat().find(r => r.includes('DKIM1') || r.includes('p='));
      if (found) { dkimRecord = found; dkimOk = true; break; }
    }
  }
  // Fallback: CNAME-based DKIM with common selectors
  if (!dkimOk && !dkimRecord) {
    for (const selector of ['mail', 'ses', 'amazonses']) {
      const cnames = await resolveCname(`${selector}._domainkey.${domain}`);
      if (cnames.length) { dkimRecord = cnames[0]; dkimOk = true; break; }
    }
  }

  // DMARC — _dmarc.domain TXT
  const dmarcTxt = await resolveTxt(`_dmarc.${domain}`);
  const dmarcRecord = dmarcTxt.flat().find(r => r.startsWith('v=DMARC1'));

  return {
    domain,
    spf:   { ok: !!spfRecord,   record: spfRecord   || null },
    dkim:  { ok: dkimOk,        record: dkimRecord  || null },
    dmarc: { ok: !!dmarcRecord, record: dmarcRecord || null },
  };
}

async function isAdmin(userId, brandId) {
  const r = await query('SELECT role FROM user_brand_roles WHERE user_id=$1 AND brand_id=$2', [userId, brandId]);
  return r[0] && r[0].role === 'owner';
}

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  const user = requireAuth(req, res);
  if (!user) return;

  const { id, action, member_id, block_id, media_id, type } = req.query;

  try {
    if (req.method === 'GET') {
      // API key — return current key for the brand (owner only)
      if (id && action === 'api_key') {
        if (!await isAdmin(user.id, id)) return res.status(403).json({ error: 'Sem permissão' });
        const rows = await query('SELECT api_key FROM brands WHERE id=$1', [id]);
        return res.status(200).json({ api_key: rows[0]?.api_key || null });
      }

      // DNS health check — SPF / DKIM / DMARC verification for brand's from_email domain
      if (id && action === 'dns_check') {
        const rows = await query('SELECT from_email FROM brands WHERE id=$1', [id]);
        if (!rows[0]?.from_email) return res.status(200).json({ error: 'from_email não configurado' });
        const domain = rows[0].from_email.split('@')[1]?.toLowerCase();
        if (!domain) return res.status(200).json({ error: 'Domínio inválido no from_email' });
        const result = await checkDnsRecord(domain);
        return res.status(200).json(result);
      }

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
      // List all brands accessible to the current admin + access status for a given member
      if (action === 'user_brands' && member_id) {
        if (!id) return res.status(400).json({ error: 'id (brand_id) obrigatório para verificar permissão' });
        if (!await isAdmin(user.id, id)) return res.status(403).json({ error: 'Sem permissão' });
        // All active brands in the platform
        const allBrands = await query(
          `SELECT id, name, color, logo_url FROM brands WHERE active = TRUE ORDER BY name`
        );
        // Member's account-level role (their role in the current brand)
        const accountRoleRow = await query(
          'SELECT role FROM user_brand_roles WHERE user_id=$1 AND brand_id=$2',
          [member_id, id]
        );
        const accountRole = accountRoleRow[0]?.role || 'viewer';
        // Brands already accessible to the target member
        const memberRoles = await query(
          `SELECT brand_id FROM user_brand_roles WHERE user_id = $1`,
          [member_id]
        );
        const accessSet = new Set(memberRoles.map(r => r.brand_id));
        // Normalise any existing per-brand roles that differ from the account role
        await query(
          `UPDATE user_brand_roles SET role=$1
           WHERE user_id=$2 AND role<>$1`,
          [accountRole, member_id]
        );
        const result = allBrands.map(b => ({
          ...b,
          has_access: accessSet.has(b.id),
          role: accessSet.has(b.id) ? accountRole : null,
        }));
        return res.status(200).json({ data: result });
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
          const role = roleRow[0]?.role || null;
          // empty areas = full access (no restrictions configured)
          return res.status(200).json({ areas: areas.map(r => r.area), restricted: areas.length > 0, role });
        } catch (e) {
          if (e.code === '42P01') return res.status(200).json({ areas: [], restricted: false, role: null, _migration_pending: true });
          throw e;
        }
      }
      // ── Global settings GET (owner-only) ─────────────────────
      if (action === 'global_settings') {
        const ownerRow = await query(
          `SELECT 1 FROM user_brand_roles WHERE user_id=$1 AND role='owner' LIMIT 1`, [user.id]
        );
        if (!ownerRow[0]) return res.status(403).json({ error: 'Acesso restrito a administradores' });
        const DEFAULTS = { font_size: '14px', font_family: 'Arial, sans-serif', line_height: '1.6', email_width: '600px' };
        try {
          const rows = await query('SELECT font_size, font_family, line_height, email_width FROM global_settings WHERE id=1');
          return res.status(200).json(rows[0] || DEFAULTS);
        } catch (e) {
          if (e.code === '42P01') return res.status(200).json(DEFAULTS);
          throw e;
        }
      }

      // ── Domain whitelist GET (global, owner-only) ────────────
      if (action === 'domain_whitelist') {
        const ownerRow = await query(
          `SELECT 1 FROM user_brand_roles WHERE user_id=$1 AND role='owner' LIMIT 1`, [user.id]
        );
        if (!ownerRow[0]) return res.status(403).json({ error: 'Acesso restrito a administradores' });
        try {
          const rows = await query(
            `SELECT dw.id, dw.domain, dw.note, dw.use_sender, dw.use_utm, dw.created_at, u.name AS created_by_name
             FROM domain_whitelist dw
             LEFT JOIN users u ON u.id = dw.created_by
             ORDER BY dw.created_at DESC`
          );
          return res.status(200).json({ data: rows });
        } catch (e) {
          if (e.code === '42P01') return res.status(200).json({ data: [], _migration_pending: true });
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
      // Owners see all active brands; others see only their assigned brands
      const isOwner = await query(
        `SELECT 1 FROM user_brand_roles WHERE user_id=$1 AND role='owner' LIMIT 1`, [user.id]
      );
      const rows = isOwner[0]
        ? await query(
            `SELECT b.id, b.name, b.color, b.logo_url, b.from_name, b.from_email, 'owner' AS role
             FROM brands b WHERE b.active = TRUE ORDER BY b.name`
          )
        : await query(
            `SELECT b.id, b.name, b.color, b.logo_url, b.from_name, b.from_email, ubr.role
             FROM brands b
             JOIN user_brand_roles ubr ON ubr.brand_id = b.id AND ubr.user_id = $1
             WHERE b.active = TRUE ORDER BY b.name`,
            [user.id]
          );
      return res.status(200).json({ data: rows });
    }

    // ── Global settings PUT (owner-only) ─────────────────────────
    if (req.method === 'PUT' && action === 'global_settings') {
      const ownerRow = await query(
        `SELECT 1 FROM user_brand_roles WHERE user_id=$1 AND role='owner' LIMIT 1`, [user.id]
      );
      if (!ownerRow[0]) return res.status(403).json({ error: 'Acesso restrito a administradores' });
      const { font_size, font_family, line_height, email_width } = req.body || {};
      try {
        await query(
          `INSERT INTO global_settings (id, font_size, font_family, line_height, email_width, updated_at)
           VALUES (1, $1, $2, $3, $4, NOW())
           ON CONFLICT (id) DO UPDATE SET font_size=$1, font_family=$2, line_height=$3, email_width=$4, updated_at=NOW()`,
          [font_size || '14px', font_family || 'Arial, sans-serif', line_height || '1.6', email_width || '600px']
        );
        return res.status(200).json({ ok: true });
      } catch (e) {
        if (e.code === '42P01') return res.status(503).json({ error: 'Migração em falta: corre 035_global_settings.sql no Supabase.' });
        throw e;
      }
    }

    // ── Domain whitelist POST / DELETE (global, owner-only) ──────
    if (action === 'domain_whitelist') {
      const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
      const ownerRow = await query(
        `SELECT 1 FROM user_brand_roles WHERE user_id=$1 AND role='owner' LIMIT 1`, [user.id]
      );
      if (!ownerRow[0]) return res.status(403).json({ error: 'Acesso restrito a administradores' });

      if (req.method === 'POST') {
        const { domain, note, use_sender, use_utm } = req.body || {};
        if (!domain) return res.status(400).json({ error: 'Domínio obrigatório' });
        const clean = domain.trim().toLowerCase().replace(/^@/, '');
        if (!DOMAIN_RE.test(clean)) return res.status(400).json({ error: 'Domínio inválido. Exemplo: empresa.pt' });
        try {
          const rows = await query(
            `INSERT INTO domain_whitelist (domain, note, use_sender, use_utm, created_by) VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (domain) DO NOTHING RETURNING id`,
            [clean, note || null, use_sender !== false, !!use_utm, user.id]
          );
          if (!rows[0]) return res.status(409).json({ error: 'Domínio já existe na lista' });
          return res.status(201).json({ id: rows[0].id, domain: clean });
        } catch (e) {
          if (e.code === '42P01') return res.status(503).json({ error: 'Migração em falta: corre 031_domain_whitelist.sql no Supabase.' });
          throw e;
        }
      }
      if (req.method === 'PUT') {
        const { id: wlId, domain, note, use_sender, use_utm } = req.body || {};
        if (!wlId || !domain) return res.status(400).json({ error: 'id e domain obrigatórios' });
        const clean = domain.trim().toLowerCase().replace(/^@/, '');
        if (!DOMAIN_RE.test(clean)) return res.status(400).json({ error: 'Domínio inválido. Exemplo: empresa.pt' });
        try {
          const upd = await query(
            'UPDATE domain_whitelist SET domain=$1, note=$2, use_sender=$3, use_utm=$4 WHERE id=$5 RETURNING id',
            [clean, note || null, use_sender !== false, !!use_utm, wlId]
          );
          if (!upd[0]) return res.status(404).json({ error: 'Registo não encontrado' });
          return res.status(200).json({ ok: true, domain: clean });
        } catch (e) {
          if (e.code === '42P01') return res.status(503).json({ error: 'Migração em falta: corre 031_domain_whitelist.sql no Supabase.' });
          if (e.code === '23505') return res.status(409).json({ error: 'Domínio já existe na lista' });
          throw e;
        }
      }
      if (req.method === 'DELETE') {
        const { id: wlId } = req.body || {};
        if (!wlId) return res.status(400).json({ error: 'id obrigatório' });
        try {
          await query('DELETE FROM domain_whitelist WHERE id=$1', [wlId]);
          return res.status(200).json({ ok: true });
        } catch (e) {
          if (e.code === '42P01') return res.status(503).json({ error: 'Migração em falta: corre 031_domain_whitelist.sql no Supabase.' });
          throw e;
        }
      }
      return res.status(405).json({ error: 'Método não permitido' });
    }

    // Generate (or regenerate) API key for the brand
    if (req.method === 'POST' && id && action === 'generate_api_key') {
      if (!await isAdmin(user.id, id)) return res.status(403).json({ error: 'Sem permissão' });
      const newKey = 'pm_' + crypto.randomBytes(32).toString('hex');
      await query('UPDATE brands SET api_key=$1 WHERE id=$2', [newKey, id]);
      return res.status(200).json({ api_key: newKey });
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

    if (req.method === 'POST' && id && action === 'media-upload') {
      if (!process.env.BLOB_READ_WRITE_TOKEN) {
        return res.status(503).json({ error: 'BLOB_READ_WRITE_TOKEN não configurado na Vercel.' });
      }
      const { data_base64, mime_type, filename } = req.body || {};
      if (!data_base64 || !mime_type) return res.status(400).json({ error: 'data_base64 e mime_type obrigatórios' });
      const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }[mime_type] || 'bin';
      const shortId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const blobName = `m/${id}/${shortId}.${ext}`;
      try {
        const buffer = Buffer.from(data_base64, 'base64');
        const blob = await put(blobName, buffer, { access: 'public', contentType: mime_type });
        return res.status(200).json({ url: blob.url });
      } catch (e) {
        return res.status(500).json({ error: e.message || 'Erro ao fazer upload' });
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
      const safeRole = ['owner','editor','viewer'].includes(role) ? role : 'editor';
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

      // Send welcome email via AWS SES API
      let emailSent = false;
      let emailError = null;
      const brandRows = await query('SELECT name, from_name, from_email FROM brands WHERE id=$1', [id]);
      const brandName  = brandRows[0]?.name || id;
      const fromName   = brandRows[0]?.from_name  || 'PrimeMail';
      const fromEmail  = brandRows[0]?.from_email || `info@caetano.pt`;
      const appUrl     = process.env.APP_URL || 'https://email-marketing-eta.vercel.app';
      const roleLabel  = { owner: 'Administrador', editor: 'Editor', viewer: 'Marketing Account' };
      const emailSubject = `Foste adicionado à equipa ${brandName} no PrimeMail`;
      const emailHtml = `<p>Olá ${name},</p>
        <p>Foste adicionado à marca <strong>${brandName}</strong> no PrimeMail com a função <strong>${roleLabel[safeRole] || safeRole}</strong>.</p>
        <p>Podes aceder à plataforma em <a href="${appUrl}">${appUrl}</a> com o teu email e a password definida pelo administrador.</p>
        <p>Bem-vindo à equipa!</p>`;
      const emailText = `Olá ${name},\n\nForaste adicionado à marca ${brandName} no PrimeMail com a função ${roleLabel[safeRole] || safeRole}.\n\nAcede em: ${appUrl}\n\nBem-vindo à equipa!`;

      if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
        try {
          await getSESClient().send(new SendEmailCommand({
            Source: `"${fromName}" <${fromEmail}>`,
            Destination: { ToAddresses: [email.toLowerCase().trim()] },
            Message: {
              Subject: { Data: emailSubject, Charset: 'UTF-8' },
              Body: {
                Html: { Data: emailHtml, Charset: 'UTF-8' },
                Text: { Data: emailText, Charset: 'UTF-8' },
              },
            },
          }));
          emailSent = true;
        } catch (sesErr) {
          emailError = sesErr.message;
          console.error('invite email SES error:', sesErr);
        }
      } else {
        emailError = 'AWS SES não configurado (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY em falta)';
      }

      return res.status(201).json({ ok: true, user_id: userId, email_sent: emailSent, email_error: emailError });
    }

    // Grant or revoke access to a specific brand for a member
    if (req.method === 'PUT' && id && action === 'set_brand_access' && member_id) {
      if (!await isAdmin(user.id, id)) return res.status(403).json({ error: 'Sem permissão' });
      if (parseInt(member_id) === user.id) return res.status(400).json({ error: 'Não podes alterar o teu próprio acesso' });
      const { brand_id: targetBrandId, granted } = req.body || {};
      if (!targetBrandId) return res.status(400).json({ error: 'brand_id obrigatório' });
      // Verify current user has admin access to the target brand too
      if (!await isAdmin(user.id, targetBrandId)) return res.status(403).json({ error: 'Sem permissão na marca de destino' });
      // Always use the member's account-level role (role in the current brand `id`)
      const accountRoleRow = await query(
        'SELECT role FROM user_brand_roles WHERE user_id=$1 AND brand_id=$2',
        [member_id, id]
      );
      const safeRole = accountRoleRow[0]?.role === 'owner' ? 'owner' : 'viewer';
      if (granted) {
        await query(
          `INSERT INTO user_brand_roles (user_id, brand_id, role) VALUES ($1,$2,$3)
           ON CONFLICT (user_id, brand_id) DO UPDATE SET role = EXCLUDED.role`,
          [member_id, targetBrandId, safeRole]
        );
      } else {
        try { await query('DELETE FROM user_brand_areas WHERE user_id=$1 AND brand_id=$2', [member_id, targetBrandId]); } catch (_) {}
        await query('DELETE FROM user_brand_roles WHERE user_id=$1 AND brand_id=$2', [member_id, targetBrandId]);
      }
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'PUT' && id && action === 'update_role' && member_id) {
      if (!await isAdmin(user.id, id)) return res.status(403).json({ error: 'Sem permissão' });
      const { role } = req.body || {};
      if (!['owner','editor','viewer'].includes(role)) return res.status(400).json({ error: 'role inválido' });
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
      try { await query('DELETE FROM user_brand_areas WHERE user_id=$1 AND brand_id=$2', [member_id, id]); } catch (_) {}
      await query('DELETE FROM user_brand_roles WHERE user_id=$1 AND brand_id=$2', [member_id, id]);
      return res.status(200).json({ ok: true });
    }

    // Eliminar conta permanentemente (apaga de todas as marcas — CASCADE)
    if (req.method === 'DELETE' && id && action === 'delete_user' && member_id) {
      if (!await isAdmin(user.id, id)) return res.status(403).json({ error: 'Sem permissão' });
      if (parseInt(member_id) === user.id) return res.status(400).json({ error: 'Não podes eliminar a tua própria conta' });
      // Only owners can delete other owners
      const [target] = await query('SELECT role FROM user_brand_roles WHERE user_id=$1 AND brand_id=$2', [member_id, id]);
      if (target?.role === 'owner') {
        const [requester] = await query('SELECT role FROM user_brand_roles WHERE user_id=$1 AND brand_id=$2', [user.id, id]);
        if (requester?.role !== 'owner') return res.status(403).json({ error: 'Apenas um owner pode eliminar outro owner' });
      }
      await query('DELETE FROM users WHERE id=$1', [member_id]);
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'PUT' && id && action === 'edit_member' && member_id) {
      if (!await isAdmin(user.id, id)) return res.status(403).json({ error: 'Sem permissão' });
      const { name, email, role: newRole, password } = req.body || {};
      if (!name?.trim()) return res.status(400).json({ error: 'Nome obrigatório' });
      if (!email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Email inválido' });
      if (password !== undefined && password !== '' && String(password).length < 6)
        return res.status(400).json({ error: 'Password deve ter pelo menos 6 caracteres' });
      const normalEmail = email.toLowerCase().trim();
      const conflict = await query('SELECT id FROM users WHERE email=$1 AND id<>$2', [normalEmail, member_id]);
      if (conflict[0]) return res.status(409).json({ error: 'Esse email já está em uso por outro utilizador' });
      // Update name + email (+ optional password hash)
      if (password) {
        const hash = bcrypt.hashSync(String(password), 10);
        await query('UPDATE users SET name=$1, email=$2, password_hash=$3 WHERE id=$4', [name.trim(), normalEmail, hash, member_id]);
      } else {
        await query('UPDATE users SET name=$1, email=$2 WHERE id=$3', [name.trim(), normalEmail, member_id]);
      }
      // Update role if provided
      if (newRole && ['owner','editor','viewer'].includes(newRole)) {
        await query('UPDATE user_brand_roles SET role=$1 WHERE user_id=$2 AND brand_id=$3', [newRole, member_id, id]);
      }
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'PUT' && id && action === 'set_active' && member_id) {
      if (!await isAdmin(user.id, id)) return res.status(403).json({ error: 'Sem permissão' });
      if (parseInt(member_id) === user.id) return res.status(400).json({ error: 'Não podes desactivar a tua própria conta' });
      const { active } = req.body || {};
      await query('UPDATE users SET active=$1 WHERE id=$2', [!!active, member_id]);
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

    // ── Create brand (POST with no id/action) ──────────────────────
    if (req.method === 'POST' && !id && !action) {
      const ownerRow = await query(
        `SELECT 1 FROM user_brand_roles WHERE user_id=$1 AND role='owner' LIMIT 1`, [user.id]
      );
      if (!ownerRow[0]) return res.status(403).json({ error: 'Acesso restrito a administradores' });
      const { name, color, from_name, from_email, id: slugInput } = req.body || {};
      if (!name?.trim()) return res.status(400).json({ error: 'Nome obrigatório' });
      // Generate slug from provided id or from name (remove accents + non-alphanumeric)
      const slug = (slugInput?.trim() ||
        name.trim().toLowerCase()
          .normalize('NFD').replace(/[̀-ͯ]/g, '')
          .replace(/[^a-z0-9]+/g, '').slice(0, 30));
      if (!slug) return res.status(400).json({ error: 'ID de marca inválido' });
      try {
        const [brand] = await query(
          `INSERT INTO brands (id, name, color, from_name, from_email, active)
           VALUES ($1, $2, $3, $4, $5, TRUE) RETURNING id, name`,
          [slug, name.trim(), color || '#0f172a', from_name?.trim() || null, from_email?.trim() || null]
        );
        await query(
          `INSERT INTO user_brand_roles (user_id, brand_id, role) VALUES ($1, $2, 'owner')`,
          [user.id, brand.id]
        );
        return res.status(201).json({ id: brand.id, name: brand.name });
      } catch (e) {
        if (e.code === '23505') return res.status(409).json({ error: `ID "${slug}" já existe. Escolhe outro nome ou ID.` });
        throw e;
      }
    }

    // ── Delete brand (DELETE with action=delete_brand) ───────────────
    if (req.method === 'DELETE' && id && action === 'delete_brand') {
      if (!await isAdmin(user.id, id)) return res.status(403).json({ error: 'Sem permissão' });
      const ownerRow = await query(
        `SELECT 1 FROM user_brand_roles WHERE user_id=$1 AND role='owner' LIMIT 1`, [user.id]
      );
      if (!ownerRow[0]) return res.status(403).json({ error: 'Acesso restrito a administradores' });
      const { confirm: confirmed } = req.body || {};
      if (!confirmed) {
        // Return counts for the confirmation dialog
        const [contactsRes, campaignsRes, listsRes, brandRes] = await Promise.all([
          query(`SELECT COUNT(*)::int AS n FROM contacts WHERE brand_id=$1`, [id]),
          query(`SELECT COUNT(*)::int AS n FROM campaigns WHERE brand_id=$1`, [id]),
          query(`SELECT COUNT(*)::int AS n FROM lists WHERE brand_id=$1`, [id]),
          query(`SELECT name FROM brands WHERE id=$1`, [id]),
        ]);
        return res.status(200).json({
          requires_confirm: true,
          brand_name: brandRes[0]?.name,
          counts: { contacts: contactsRes[0]?.n ?? 0, campaigns: campaignsRes[0]?.n ?? 0, lists: listsRes[0]?.n ?? 0 },
        });
      }
      // All related tables have ON DELETE CASCADE on brand_id — one DELETE cascades everything
      await query(`DELETE FROM brands WHERE id=$1`, [id]);
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: 'Método não permitido' });
  } catch (err) {
    res.status(500).json({ error: 'Erro de servidor' });
  }
};
