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

      // Sem tempos-limite, o comportamento por omissão do pg é esperar PARA
      // SEMPRE por uma ligação livre. Numa função serverless isso significa
      // que, sob carga, os pedidos empilham até a Vercel os matar aos 60 s —
      // e o utilizador vê um pedido que nunca responde em vez de um erro.
      // Falhar depressa e com mensagem é melhor do que pendurar.
      connectionTimeoutMillis: 8000,
      // Uma ligação parada é devolvida ao pooler em vez de ficar reservada.
      idleTimeoutMillis: 30000,
      // Tecto para uma consulta individual. O maior trabalho por invocação é
      // um lote de envio, que corre em ondas curtas — nenhuma consulta isolada
      // precisa de 20 s. Uma que precise está avariada, e é preferível vê-la
      // falhar a ter a função inteira a morrer por causa dela.
      statement_timeout: 20000,
      query_timeout: 20000,
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
