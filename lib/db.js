const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('FATAL: DATABASE_URL env var is missing — set it in Vercel project settings.');
  throw new Error('DATABASE_URL not configured');
}

let pool;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Supabase connection pooler (port 6543) uses a self-signed cert;
      // rejectUnauthorized:false keeps encryption on but skips cert chain verification.
      // For direct connections (port 5432) this can be set to true.
      ssl: { rejectUnauthorized: false },
      max: 10,
    });
  }
  return pool;
}

async function query(sql, params = []) {
  const result = await getPool().query(sql, params);
  return result.rows;
}

async function transaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const q = (sql, params = []) => client.query(sql, params).then(r => r.rows);
    const result = await fn(q);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { getPool, query, transaction };
