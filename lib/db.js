const { Pool } = require('pg');

let pool;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return pool;
}

// Helper: run a query and return rows array
async function query(sql, params = []) {
  const db = getPool();
  const result = await db.query(sql, params);
  return result.rows;
}

module.exports = { getPool, query };
