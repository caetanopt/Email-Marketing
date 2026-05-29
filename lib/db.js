const { Pool } = require('pg');

let pool;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: true },
      max: 10,
    });
  }
  return pool;
}

async function query(sql, params = []) {
  const db = getPool();
  const result = await db.query(sql, params);
  return result.rows;
}

module.exports = { getPool, query };
