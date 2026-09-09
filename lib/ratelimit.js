const { query } = require('./db');

// S-5 — limitador de ritmo de janela fixa, sobre Postgres.
//
// O ambiente é serverless (Vercel): não há memória partilhada entre
// invocações nem Redis, por isso o contador vive na base de dados. Cada
// janela é uma linha (bucket, key, window_start); o INSERT ... ON CONFLICT
// incrementa de forma atómica, o que aguenta invocações concorrentes sem
// perder contagens.
//
// Filosofia de falha: ABRE. Se a tabela ainda não existe (migração 058 por
// correr) ou a base de dados está com problemas, deixa passar. Um limitador
// que fecha quando a BD tropeça transforma uma indisponibilidade da BD numa
// negação de serviço no login — o contrário do que se quer.

let _ensured = false;
async function ensureTable() {
  if (_ensured) return;
  try {
    await query(`CREATE TABLE IF NOT EXISTS rate_limits (
      bucket TEXT NOT NULL, key TEXT NOT NULL,
      window_start TIMESTAMPTZ NOT NULL, count INT NOT NULL DEFAULT 0,
      PRIMARY KEY (bucket, key, window_start))`);
    _ensured = true;
  } catch (e) {
    // Sem permissão para criar (ou já existe com outra definição): não
    // insistir a cada pedido. A tabela vem da migração à mão de qualquer forma.
    _ensured = true;
  }
}

// O IP de quem chama, atrás do proxy da Vercel. x-forwarded-for pode trazer
// uma cadeia "cliente, proxy1, proxy2" — o cliente é o primeiro. Sem cabeçalho
// (chamada local, teste), devolve 'desconhecido' para não deixar a chave vazia.
function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'desconhecido';
}

// Devolve { ok, retryAfter } — ok=false quando o limite foi excedido.
// windowSec: tamanho da janela; max: pedidos permitidos por janela.
async function rateLimit(bucket, key, max, windowSec) {
  await ensureTable();
  const ms = windowSec * 1000;
  const windowStart = new Date(Math.floor(Date.now() / ms) * ms);
  try {
    const rows = await query(
      `INSERT INTO rate_limits (bucket, key, window_start, count)
       VALUES ($1, $2, $3, 1)
       ON CONFLICT (bucket, key, window_start)
       DO UPDATE SET count = rate_limits.count + 1
       RETURNING count`,
      [bucket, String(key), windowStart]
    );
    const count = rows[0].count;
    // Limpeza oportunista: de vez em quando, apagar janelas já passadas.
    if (Math.random() < 0.02) {
      query(`DELETE FROM rate_limits WHERE window_start < NOW() - INTERVAL '1 day'`).catch(() => {});
    }
    if (count > max) {
      const retryAfter = Math.ceil((windowStart.getTime() + ms - Date.now()) / 1000);
      return { ok: false, retryAfter: Math.max(retryAfter, 1) };
    }
    return { ok: true };
  } catch (e) {
    if (e.code === '42P01') return { ok: true }; // tabela em falta → abrir
    console.error('rate limit:', e?.message);
    return { ok: true }; // qualquer erro da BD → abrir
  }
}

module.exports = { rateLimit, clientIp };
