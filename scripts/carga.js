#!/usr/bin/env node
//
// Arnês de carga — onde é que isto deixa de aguentar.
//
// Mede os quatro caminhos que decidem o tecto da plataforma, contra volumes
// que ainda não existem em produção:
//
//   1. arranque de um envio   — o INSERT … SELECT que cria campaign_recipients
//   2. reclamação de um lote  — o UPDATE … RETURNING que cada invocação corre
//   3. listagem de contactos  — a paginação por OFFSET, que degrada com o fim
//                               da tabela
//   4. agregação do painel    — o global_stats, que toca as duas maiores
//
// NÃO CORRER CONTRA PRODUÇÃO. Escreve centenas de milhares de linhas e não as
// apaga sozinho — o `--limpar` é um passo à parte, para não haver um caminho
// em que um erro de digitação apague dados a sério.
//
// Uso:
//   CARGA_DATABASE_URL=postgres://…  node scripts/carga.js --contactos 100000
//   CARGA_DATABASE_URL=postgres://…  node scripts/carga.js --limpar
//
// A variável é CARGA_DATABASE_URL e não DATABASE_URL de propósito: a de
// produção está no ambiente de quem trabalha neste repositório, e um script
// que a lê por omissão é um acidente à espera de acontecer.

const { Pool } = require('pg');

const URL_CARGA = process.env.CARGA_DATABASE_URL;
if (!URL_CARGA) {
  console.error('Falta CARGA_DATABASE_URL (uma base de dados DESCARTÁVEL).');
  console.error('Não se usa DATABASE_URL aqui — ver o cabeçalho do ficheiro.');
  process.exit(2);
}

// Segunda trava: um host que se pareça com o Supabase de produção pára aqui,
// mesmo que alguém copie o URL para a variável certa.
const SUSPEITO = /supabase\.(co|com|io)|prod|emkt\.caetano/i;
if (SUSPEITO.test(URL_CARGA) && process.env.CARGA_EU_SEI_O_QUE_FACO !== 'sim') {
  console.error('O URL parece de produção. Se for mesmo uma cópia descartável,');
  console.error('define CARGA_EU_SEI_O_QUE_FACO=sim. Se hesitaste, é porque não é.');
  process.exit(2);
}

const args = process.argv.slice(2);
const arg = (nome, omissao) => {
  const i = args.indexOf(`--${nome}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : omissao;
};
const LIMPAR    = args.includes('--limpar');
const CONTACTOS = parseInt(arg('contactos', '100000'), 10);
const MARCA     = arg('marca', 'carga');

const pool = new Pool({ connectionString: URL_CARGA, ssl: { rejectUnauthorized: false }, max: 4 });
const q = (sql, p = []) => pool.query(sql, p).then(r => r.rows);

// Os contactos de teste são reconhecíveis pelo email. É por aí que o
// --limpar os encontra, e é o que garante que nunca toca noutra coisa.
const MARCADOR = '@carga.invalido';

async function cronometrar(nome, fn) {
  const t0 = process.hrtime.bigint();
  const r = await fn();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`  ${nome.padEnd(42)} ${ms.toFixed(0).padStart(8)} ms${r != null ? `   (${r})` : ''}`);
  return ms;
}

async function semear() {
  console.log(`\nA semear ${CONTACTOS.toLocaleString('pt-PT')} contactos…`);
  // generate_series faz isto do lado do servidor: mandar 100 mil linhas pelo
  // driver mediria a rede, não a base de dados. E o tecto dos 65535
  // parâmetros do protocolo Bind tornaria-o impossível de uma vez só.
  await cronometrar('INSERT generate_series', async () => {
    await q(
      `INSERT INTO contacts (email, name, status, created_at)
       SELECT 'c' || g || '${MARCADOR}', 'Contacto ' || g, 'active',
              NOW() - (g || ' seconds')::interval
         FROM generate_series(1, $1) g
       ON CONFLICT (email) DO NOTHING`,
      [CONTACTOS]
    );
    const [{ n }] = await q(`SELECT COUNT(*)::int AS n FROM contacts WHERE email LIKE '%${MARCADOR}'`);
    return `${n} em base`;
  });
}

async function medir() {
  console.log('\nCaminhos:');

  // 1. Arranque de um envio. Não cria uma campanha real — mede a forma da
  //    consulta, que é o que interessa: um INSERT alimentado por um SELECT,
  //    sem um parâmetro por contacto.
  await cronometrar('1. arranque (INSERT … SELECT, a seco)', async () => {
    const [{ n }] = await q(
      `SELECT COUNT(*)::int AS n FROM contacts
        WHERE status = 'active' AND email LIKE '%${MARCADOR}'
          AND NOT EXISTS (SELECT 1 FROM suppression s WHERE s.email = contacts.email)`
    );
    return `${n} elegíveis`;
  });

  // 2. Reclamação de um lote — a consulta que cada invocação do cron corre.
  await cronometrar('2. reclamação de lote (500)', async () => {
    await q(
      `SELECT id FROM campaign_recipients
        WHERE status IN ('pending','retry')
        ORDER BY id LIMIT 500 FOR UPDATE SKIP LOCKED`
    );
  });

  // 3. Paginação. A primeira página e uma página funda: a diferença entre as
  //    duas é o custo do OFFSET, e é a que cresce.
  await cronometrar('3a. contactos, página 1', () =>
    q(`SELECT id, email, name FROM contacts ORDER BY created_at DESC LIMIT 50 OFFSET 0`));
  await cronometrar(`3b. contactos, página ${Math.floor(CONTACTOS / 50)}`, () =>
    q(`SELECT id, email, name FROM contacts ORDER BY created_at DESC LIMIT 50 OFFSET $1`,
      [Math.max(0, CONTACTOS - 50)]));
  await cronometrar('3c. contactos, pesquisa por texto', () =>
    q(`SELECT id, email FROM contacts WHERE email ILIKE $1 ORDER BY created_at DESC LIMIT 50`,
      [`%99999%`]));

  // 4. Agregação do painel, com e sem janela de data — a diferença é
  //    exactamente o que a Fase 4 corrigiu.
  await cronometrar('4a. painel, 12 meses', () =>
    q(`SELECT COUNT(*)::int FROM campaign_recipients cr
         JOIN campaigns c ON c.id = cr.campaign_id
        WHERE c.status='sent' AND c.sent_at >= NOW() - INTERVAL '365 days'`));
  await cronometrar('4b. painel, sem janela (o antigo)', () =>
    q(`SELECT COUNT(*)::int FROM campaign_recipients cr
         JOIN campaigns c ON c.id = cr.campaign_id
        WHERE c.status='sent'`));
}

async function limpar() {
  console.log('\nA apagar os contactos de carga…');
  const r = await pool.query(`DELETE FROM contacts WHERE email LIKE '%${MARCADOR}'`);
  console.log(`  ${r.rowCount} apagados.`);
}

(async () => {
  try {
    if (LIMPAR) { await limpar(); return; }
    await semear();
    await medir();
    console.log('\nPara apagar o que foi semeado:  node scripts/carga.js --limpar\n');
  } catch (e) {
    console.error('\nFalhou:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
