const { cors } = require('../lib/auth');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;

  const checks = {
    env: {
      DB_HOST:     !!process.env.DB_HOST,
      DB_PORT:     !!process.env.DB_PORT,
      DB_NAME:     !!process.env.DB_NAME,
      DB_USER:     !!process.env.DB_USER,
      DB_PASSWORD: !!process.env.DB_PASSWORD,
      JWT_SECRET:  !!process.env.JWT_SECRET,
    },
    db: null,
    db_error: null,
  };

  try {
    const { getPool } = require('../lib/db');
    const db = getPool();
    const [[row]] = await db.query('SELECT VERSION() AS version');
    checks.db = row.version;
  } catch (err) {
    checks.db_error = err.message;
  }

  const ok = Object.values(checks.env).every(Boolean) && !!checks.db;
  res.status(ok ? 200 : 500).json({ ok, ...checks });
};
