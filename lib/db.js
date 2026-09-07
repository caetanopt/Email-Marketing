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

// A coluna existe?
//
// Serve para não tentar ALTERs que já não se aplicam. As auto-migrações
// existem para o código funcionar antes de a migração correr à mão, mas
// depois de ela correr o ALTER falha com 42703 — e o Postgres registava esse
// erro nos logs a cada arranque de instância, o que faz parecer que há algo
// avariado quando não há. Uma consulta ao catálogo é barata e não deixa rasto.
//
// O resultado é guardado por processo: o esquema não muda a meio de uma
// instância sem ser por uma migração, e essa traz instâncias novas.
const _colunas = new Map();
async function colunaExiste(tabela, coluna, q = query) {
  const chave = `${tabela}.${coluna}`;
  if (!_colunas.has(chave)) {
    _colunas.set(chave, (async () => {
      try {
        const r = await q(
          `SELECT 1 FROM information_schema.columns
           WHERE table_name = $1 AND column_name = $2 LIMIT 1`,
          [tabela, coluna]
        );
        return !!r[0];
      } catch (_) {
        // Sem conseguir verificar, assume-se que existe: quem chama tenta o
        // ALTER e trata o erro, como fazia antes.
        return true;
      }
    })());
  }
  return _colunas.get(chave);
}

module.exports = { getPool, query, transaction, colunaExiste };
