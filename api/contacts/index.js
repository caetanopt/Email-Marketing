const { query, transaction } = require('../../lib/db');
const { requireAuth, cors, requireBrand } = require('../../lib/auth');

const IMPORT_INIT_SQL = `
  CREATE TABLE IF NOT EXISTS import_jobs (
    id         SERIAL PRIMARY KEY,
    brand_id   VARCHAR NOT NULL,
    list_id    INTEGER,
    list_name  VARCHAR,
    file_name  VARCHAR,
    status     VARCHAR DEFAULT 'uploading',
    total      INTEGER DEFAULT 0,
    processed  INTEGER DEFAULT 0,
    imported   INTEGER DEFAULT 0,
    skipped    INTEGER DEFAULT 0,
    failed_cnt INTEGER DEFAULT 0,
    created_by INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS import_chunks (
    id       SERIAL PRIMARY KEY,
    job_id   INTEGER NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
    seq      INTEGER NOT NULL,
    status   VARCHAR DEFAULT 'pending',
    contacts JSONB NOT NULL,
    imported INTEGER DEFAULT 0,
    skipped  INTEGER DEFAULT 0,
    failed   INTEGER DEFAULT 0
  );
  ALTER TABLE import_chunks ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ`;

const EMAIL_RE = /^[^\s@,;:]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

// ── Shared batch processor (used by bulk_import and cron) ──────────────────
async function processBatch(brandId, listId, batch) {
  let imported = 0, skipped = 0, failed = 0;

  const validRows = [];
  for (const c of batch) {
    const email = (c.email || '').toLowerCase().trim();
    if (!email || !EMAIL_RE.test(email)) { skipped++; continue; }
    validRows.push({ ...c, email });
  }

  if (validRows.length) {
    try {
      const allEmails = validRows.map(c => c.email);
      const allDomains = [...new Set(allEmails.map(e => '@' + e.split('@')[1]))];
      // Check exact email suppression AND blocked domains (stored as @domain.com)
      const suppressed = await query(
        `SELECT email FROM suppression WHERE email = ANY($1) OR email = ANY($2)`,
        [allEmails, allDomains]
      );
      if (suppressed.length) {
        const suppressedEmails = new Set(suppressed.filter(r => !r.email.startsWith('@')).map(r => r.email));
        const blockedDomains  = new Set(suppressed.filter(r =>  r.email.startsWith('@')).map(r => r.email));
        const before = validRows.length;
        const filtered = validRows.filter(c => {
          if (suppressedEmails.has(c.email)) return false;
          if (blockedDomains.has('@' + c.email.split('@')[1])) return false;
          return true;
        });
        skipped += before - filtered.length;
        validRows.length = 0;
        validRows.push(...filtered);
      }
    } catch (_) {}
  }

  if (validRows.length) {
    try {
      await transaction(async q => {
        const vals = [], params = [];
        let p = 1;
        validRows.forEach(c => {
          vals.push(`($${p++},$${p++},$${p++},$${p++},$${p++},'import')`);
          params.push(brandId, c.email, c.name||null, c.phone||null, c.company||null);
        });
        const inserted = await q(
          `INSERT INTO contacts (brand_id, email, name, phone, company, source)
           VALUES ${vals.join(',')}
           ON CONFLICT (brand_id, email) DO UPDATE
             SET name=COALESCE(EXCLUDED.name, contacts.name),
                 phone=COALESCE(EXCLUDED.phone, contacts.phone),
                 company=COALESCE(EXCLUDED.company, contacts.company),
                 source=EXCLUDED.source, updated_at=NOW()
           RETURNING id, email`,
          params
        );
        imported += inserted.length;

        if (listId && inserted.length) {
          const lvals = inserted.map((_, i) => `($1,$${i+2})`).join(',');
          await q(
            `INSERT INTO list_members (list_id, contact_id) VALUES ${lvals} ON CONFLICT DO NOTHING`,
            [listId, ...inserted.map(r => r.id)]
          );
          const emailToId = Object.fromEntries(inserted.map(r => [r.email, r.id]));
          for (const c of validRows) {
            if (!c._extra_data) continue;
            const cid = emailToId[c.email];
            if (!cid) continue;
            await q(
              'UPDATE list_members SET extra_data=$1::jsonb WHERE list_id=$2 AND contact_id=$3',
              [JSON.stringify(c._extra_data), listId, cid]
            );
          }
        }
      });
    } catch (err) {
      console.error('processBatch error:', err);
      failed += validRows.length;
      imported = 0;
    }
  }

  return { imported, skipped, failed };
}

// Drains pending import_chunks for jobs matching the given filter, until the
// deadline. Chunk claiming is atomic (SKIP LOCKED) so this is safe to call
// concurrently from both the external cron and an authenticated browser tab
// without double-processing the same chunk.
async function processImportQueue({ jobId = null, brandId = null, deadlineMs = 8000 } = {}) {
  await query(IMPORT_INIT_SQL);
  const DEADLINE = Date.now() + deadlineMs;
  let processed_jobs = 0;

  while (Date.now() < DEADLINE) {
    const params = [];
    let where = `status IN ('queued','processing')`;
    if (jobId)   { params.push(jobId);   where += ` AND id=$${params.length}`; }
    if (brandId) { params.push(brandId); where += ` AND brand_id=$${params.length}`; }
    const jobs = await query(
      `SELECT id, brand_id, list_id FROM import_jobs WHERE ${where} ORDER BY created_at LIMIT 1`,
      params
    );
    if (!jobs[0]) break;
    const job = jobs[0];

    await query(`UPDATE import_jobs SET status='processing', updated_at=NOW() WHERE id=$1`, [job.id]);

    // Atomically claim the next pending chunk so a concurrent invocation
    // (cron overlapping a browser-triggered call) can't grab the same one.
    // A chunk 'claimed' more than 2 minutes ago is treated as abandoned
    // (its invocation crashed/timed out) and becomes reclaimable again.
    const claimed = await query(
      `UPDATE import_chunks SET status='claimed', claimed_at=NOW()
       WHERE id = (
         SELECT id FROM import_chunks
         WHERE job_id=$1 AND (status='pending' OR (status='claimed' AND claimed_at < NOW() - INTERVAL '2 minutes'))
         ORDER BY seq FOR UPDATE SKIP LOCKED LIMIT 1
       )
       RETURNING id, contacts`,
      [job.id]
    );

    if (!claimed[0]) {
      // No claimable chunk right now — either all done, or another
      // invocation is actively mid-flight on the remaining ones. Check if truly done.
      const remaining = await query(
        `SELECT COUNT(*)::int n FROM import_chunks
         WHERE job_id=$1 AND (status='pending' OR (status='claimed' AND claimed_at >= NOW() - INTERVAL '2 minutes'))`,
        [job.id]
      );
      if (remaining[0].n > 0) break; // still in flight elsewhere, nothing more to do here

      const stats = await query(
        `SELECT COALESCE(SUM(imported),0)::int imported, COALESCE(SUM(skipped),0)::int skipped,
                COALESCE(SUM(failed),0)::int failed
         FROM import_chunks WHERE job_id=$1`,
        [job.id]
      );
      const s = stats[0];
      const jobRow = await query(
        `UPDATE import_jobs SET status='done', imported=$1, skipped=$2, failed_cnt=$3,
         processed=total, updated_at=NOW() WHERE id=$4 AND status != 'done'
         RETURNING brand_id, list_id, list_name, file_name, total, created_by`,
        [s.imported, s.skipped, s.failed, job.id]
      );
      if (jobRow[0]) {
        const j = jobRow[0];
        try {
          await query(
            `INSERT INTO imports (brand_id, file_name, list_id, list_name, total_rows, imported, skipped, failed, status, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [j.brand_id, j.file_name, j.list_id, j.list_name, j.total,
             s.imported, s.skipped, s.failed,
             s.failed === 0 ? 'completed' : (s.imported > 0 ? 'partial' : 'failed'),
             j.created_by]
          );
        } catch (_) {}
        processed_jobs++;
      }
      continue;
    }

    const chunk = claimed[0];
    const contacts = Array.isArray(chunk.contacts) ? chunk.contacts : [];
    const result = await processBatch(job.brand_id, job.list_id, contacts);

    await query(
      `UPDATE import_chunks SET status='done', imported=$1, skipped=$2, failed=$3 WHERE id=$4`,
      [result.imported, result.skipped, result.failed, chunk.id]
    );
    await query(
      `UPDATE import_jobs SET processed=processed+$1, updated_at=NOW() WHERE id=$2`,
      [contacts.length, job.id]
    );
  }

  return processed_jobs;
}

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;

  // ── Cron: process pending import jobs (no user auth) ──────────────────────
  if (req.query.action === 'import_process') {
    const isVercelCron = req.headers['x-vercel-cron'] === '1';
    const secret = process.env.CRON_SECRET;
    const auth = req.headers.authorization;
    if (!isVercelCron && (!secret || auth !== `Bearer ${secret}`)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
      const processed_jobs = await processImportQueue({ deadlineMs: 8000 });
      return res.status(200).json({ ok: true, processed_jobs });
    } catch (err) {
      console.error('import_process cron error:', err);
      return res.status(500).json({ error: 'Erro de servidor' });
    }
  }

  // ── All other actions require user auth ───────────────────────────────────
  const user = requireAuth(req, res);
  if (!user) return;

  const { brand_id, search, status, list_id, page = 1, limit = 50, action, import_id } = req.query;
  if (!brand_id) return res.status(400).json({ error: 'brand_id obrigatório' });
  if (!await requireBrand(req, res, user.id, brand_id)) return;

  try {
    // ── Imports history ─────────────────────────────────────
    if (action === 'imports') {
      if (req.method === 'GET') {
        try {
          if (import_id) {
            const rows = await query(
              `SELECT i.*, u.name AS created_by_name FROM imports i
               LEFT JOIN users u ON u.id = i.created_by
               WHERE i.id=$1 AND i.brand_id=$2`,
              [import_id, brand_id]
            );
            if (!rows[0]) return res.status(404).json({ error: 'Importação não encontrada' });
            return res.status(200).json(rows[0]);
          }
          const rows = await query(
            `SELECT i.id, i.file_name, i.list_id, i.list_name, i.total_rows,
                    i.imported, i.skipped, i.failed, i.status, i.created_at,
                    u.name AS created_by_name
             FROM imports i LEFT JOIN users u ON u.id = i.created_by
             WHERE i.brand_id=$1 ORDER BY i.created_at DESC LIMIT 50`,
            [brand_id]
          );
          return res.status(200).json({ data: rows });
        } catch (e) {
          if (e.code === '42P01') return res.status(200).json({ data: [], _migration_pending: true });
          throw e;
        }
      }
      if (req.method === 'POST') {
        const { file_name, list_id: lid, list_name, total_rows, imported, skipped, failed, status: st } = req.body || {};
        if (!file_name) return res.status(400).json({ error: 'file_name obrigatório' });
        try {
          const rows = await query(
            `INSERT INTO imports (brand_id, file_name, list_id, list_name, total_rows, imported, skipped, failed, status, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, created_at`,
            [brand_id, file_name, lid || null, list_name || null,
             total_rows||0, imported||0, skipped||0, failed||0,
             st || 'completed', user.id]
          );
          return res.status(201).json({ id: rows[0].id, created_at: rows[0].created_at });
        } catch (e) {
          if (e.code === '42P01') return res.status(503).json({ error: 'Migração em falta: corre 012_imports.sql.' });
          throw e;
        }
      }
      return res.status(405).json({ error: 'Método não permitido' });
    }

    // ── Server-side import queue ──────────────────────────────────────────────
    if (action === 'import_create' && req.method === 'POST') {
      await query(IMPORT_INIT_SQL);
      const { total, file_name, list_id: lid, list_name } = req.body || {};
      const rows = await query(
        `INSERT INTO import_jobs (brand_id, list_id, list_name, file_name, total, created_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [brand_id, lid||null, list_name||null, file_name||null, total||0, user.id]
      );
      return res.status(201).json({ job_id: rows[0].id });
    }

    if (action === 'import_chunk' && req.method === 'POST') {
      const { job_id, seq, contacts: chunk } = req.body || {};
      if (!job_id || !Array.isArray(chunk)) return res.status(400).json({ error: 'job_id e contacts obrigatórios' });
      await query(
        `INSERT INTO import_chunks (job_id, seq, contacts) VALUES ($1,$2,$3::jsonb)`,
        [job_id, seq||0, JSON.stringify(chunk)]
      );
      return res.status(201).json({ ok: true });
    }

    if (action === 'import_ready' && req.method === 'POST') {
      const { job_id } = req.body || {};
      if (!job_id) return res.status(400).json({ error: 'job_id obrigatório' });
      await query(
        `UPDATE import_jobs SET status='queued', updated_at=NOW() WHERE id=$1 AND brand_id=$2`,
        [job_id, brand_id]
      );
      return res.status(200).json({ ok: true });
    }

    if (action === 'import_status' && req.method === 'GET') {
      const { job_id } = req.query;
      if (!job_id) return res.status(400).json({ error: 'job_id obrigatório' });
      try {
        await query(IMPORT_INIT_SQL);
        const rows = await query(
          `SELECT ij.id, ij.status, ij.total, ij.processed, ij.imported, ij.skipped, ij.failed_cnt,
                  ij.file_name, ij.list_name, ij.list_id, ij.created_at,
                  COALESCE((SELECT COUNT(*)::int FROM list_members WHERE list_id = ij.list_id), 0) AS list_count
           FROM import_jobs ij WHERE ij.id=$1 AND ij.brand_id=$2`,
          [job_id, brand_id]
        );
        return res.status(200).json(rows[0] || null);
      } catch (e) {
        if (e.code === '42P01') return res.status(200).json(null);
        throw e;
      }
    }

    if (action === 'import_active' && req.method === 'GET') {
      try {
        await query(IMPORT_INIT_SQL);
        const rows = await query(
          `SELECT ij.id, ij.status, ij.total, ij.processed, ij.imported, ij.skipped, ij.failed_cnt,
                  ij.file_name, ij.list_name, ij.list_id, ij.created_at,
                  COALESCE((SELECT COUNT(*)::int FROM list_members WHERE list_id = ij.list_id), 0) AS list_count
           FROM import_jobs ij WHERE ij.brand_id=$1 AND ij.status IN ('queued','pending','processing')
           ORDER BY ij.created_at DESC LIMIT 1`,
          [brand_id]
        );
        return res.status(200).json(rows[0] || null);
      } catch (e) {
        if (e.code === '42P01') return res.status(200).json(null);
        throw e;
      }
    }

    if (action === 'import_process_now' && req.method === 'POST') {
      // Lets an authenticated user's own browser tab drive an import forward
      // while it's open, instead of relying solely on the external cron
      // hitting /api/contacts?action=import_process on its own schedule.
      const { job_id } = req.body || {};
      if (!job_id) return res.status(400).json({ error: 'job_id obrigatório' });
      try {
        await processImportQueue({ jobId: Number(job_id), brandId: brand_id, deadlineMs: 8000 });
        return res.status(200).json({ ok: true });
      } catch (err) {
        console.error('import_process_now error:', err);
        return res.status(500).json({ error: 'Erro de servidor' });
      }
    }

    if (action === 'import_cancel' && req.method === 'POST') {
      const { job_id } = req.body || {};
      if (!job_id) return res.status(400).json({ error: 'job_id obrigatório' });
      try {
        await query(IMPORT_INIT_SQL);
        await query(
          `UPDATE import_jobs SET status='cancelled' WHERE id=$1 AND brand_id=$2 AND status IN ('queued','pending','processing')`,
          [job_id, brand_id]
        );
        return res.status(200).json({ ok: true });
      } catch (e) {
        if (e.code === '42P01') return res.status(200).json({ ok: true });
        throw e;
      }
    }

    if (req.method === 'GET') {
      // Listas são globais: ao filtrar por lista mostram-se TODOS os membros,
      // independentemente da marca do contacto. Sem lista, a vista é por marca.
      const params = [brand_id];
      let join = '', where = list_id ? 'WHERE $1::text IS NOT NULL' : 'WHERE c.brand_id = $1';

      if (list_id) {
        params.push(list_id);
        join = `JOIN list_members lm ON lm.contact_id = c.id AND lm.list_id = $${params.length}`;
      }
      if (status)  { params.push(status);         where += ` AND c.status = $${params.length}`; }
      if (search)  { params.push(`%${search}%`);  where += ` AND (c.email ILIKE $${params.length} OR c.name ILIKE $${params.length})`; }

      const countParams = [brand_id];
      let countJoin = '', countWhere = list_id ? 'WHERE $1::text IS NOT NULL' : 'WHERE c.brand_id = $1';
      if (list_id)  { countParams.push(list_id); countJoin = `JOIN list_members lm ON lm.contact_id = c.id AND lm.list_id = $${countParams.length}`; }
      if (status)   { countParams.push(status);          countWhere += ` AND c.status = $${countParams.length}`; }
      if (search)   { countParams.push(`%${search}%`);  countWhere += ` AND (c.email ILIKE $${countParams.length} OR c.name ILIKE $${countParams.length})`; }

      const [{ total }] = await query(
        `SELECT COUNT(*)::int AS total FROM contacts c ${countJoin} ${countWhere}`, countParams
      );

      params.push(parseInt(limit));
      params.push((parseInt(page) - 1) * parseInt(limit));

      const extraDataCol = list_id ? ', lm.extra_data' : '';
      const rows = await query(
        `SELECT c.id, c.email, c.name, c.phone, c.company, c.status, c.source,
                c.custom_attributes, c.created_at${extraDataCol}
         FROM contacts c ${join} ${where}
         ORDER BY c.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );
      return res.status(200).json({ data: rows, total, page: parseInt(page), limit: parseInt(limit) });
    }

    // ── Sync suppression ──────────────────────────────────────────────────────
    if (action === 'sync_suppression' && req.method === 'POST') {
      await query(
        `UPDATE contacts c
         SET status = (CASE WHEN s.reason='unsubscribe' THEN 'unsubscribed' WHEN s.reason='bounce' THEN 'bounced' WHEN s.reason='spam' THEN 'complained' ELSE 'suppressed' END)::contact_status
         FROM suppression s
         WHERE c.email = s.email AND c.brand_id = $1 AND c.status = 'active'`,
        [brand_id]
      );
      return res.status(200).json({ ok: true });
    }

    // ── Bulk import (direct, kept for small imports / campaign wizard) ────────
    if (action === 'bulk_import' && req.method === 'POST') {
      const { contacts: rows, list_id: listId } = req.body || {};
      if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'contacts obrigatório' });
      const result = await processBatch(brand_id, listId, rows);
      return res.status(200).json(result);
    }

    if (req.method === 'POST') {
      const { email, name, phone, company, source, custom_attributes } = req.body || {};
      if (!email) return res.status(400).json({ error: 'Email obrigatório' });
      const e = email.toLowerCase().trim();

      const rows = await query(
        `INSERT INTO contacts (brand_id, email, name, phone, company, source, custom_attributes)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (brand_id, email) DO UPDATE
           SET name=COALESCE(EXCLUDED.name, contacts.name),
               phone=COALESCE(EXCLUDED.phone, contacts.phone),
               company=COALESCE(EXCLUDED.company, contacts.company),
               source=EXCLUDED.source,
               custom_attributes=COALESCE(EXCLUDED.custom_attributes, contacts.custom_attributes),
               updated_at=NOW()
         RETURNING id, (xmax = 0) AS created`,
        [brand_id, e, name||null, phone||null,
         company||null, source||null, custom_attributes ? JSON.stringify(custom_attributes) : null]
      );
      await query(
        `UPDATE contacts SET status = (CASE WHEN s.reason='unsubscribe' THEN 'unsubscribed' ELSE 'suppressed' END)::contact_status
         FROM suppression s WHERE contacts.id=$1 AND contacts.email=s.email`,
        [rows[0].id]
      );
      return res.status(201).json({ id: rows[0].id, email: e, created: rows[0].created });
    }

    if (req.method === 'DELETE') {
      const { ids } = req.body || {};
      if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids obrigatório' });
      const placeholders = ids.map((_, i) => `$${i + 2}`).join(',');
      await query(`DELETE FROM contacts WHERE brand_id=$1 AND id IN (${placeholders})`, [brand_id, ...ids]);
      return res.status(200).json({ ok: true, deleted: ids.length });
    }

    res.status(405).json({ error: 'Método não permitido' });
  } catch (err) {
    res.status(500).json({ error: 'Erro de servidor' });
  }
};
