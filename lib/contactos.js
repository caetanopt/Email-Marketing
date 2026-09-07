// Contactos globais.
//
// Os contactos deixaram de pertencer a uma marca: um endereço de email é uma
// pessoa, e a mesma pessoa não é duas pessoas por estar em duas marcas. A
// chave passa a ser o email, tal como já acontecia no envio — que sempre
// juntou os duplicados com DISTINCT ON (lower(email)).
//
// Este ficheiro concentra a criação/actualização de contactos, que estava
// repetida em três sítios (importação em lote, criação manual e API de
// sincronização), cada um com regras ligeiramente diferentes.
//
// Compatível com os dois estados da base de dados: com a coluna
// contacts.brand_id ainda presente (antes da migração 051) e sem ela. Para
// isso nunca se escreve nessa coluna, e a unicidade não é imposta por
// ON CONFLICT (que exigiria um índice que só a 051 cria) mas por uma procura
// prévia pelo email.

const { query: dbQuery } = require('./db');

const ESTADOS_DE_SAIDA = ['unsubscribed', 'bounced', 'suppressed', 'complained'];

// A coluna brand_id ainda é NOT NULL até a migração 051 correr, e um INSERT
// sem marca seria recusado. Tira-se a obrigatoriedade uma vez por instância.
let semMarcaGarantido = null;
function permitirContactosSemMarca(q = dbQuery) {
  if (!semMarcaGarantido) {
    semMarcaGarantido = q('ALTER TABLE contacts ALTER COLUMN brand_id DROP NOT NULL')
      .catch(() => { /* 42703: a coluna já não existe (051 aplicada) */ });
  }
  return semMarcaGarantido;
}

// Contactos que entraram por um ficheiro no envio de uma campanha ficam
// marcados como não listados: continuam na base de dados — o relatório da
// campanha depende deles — mas não aparecem na página de Contactos, que é
// partilhada por todos os utilizadores. Deixam de ser não listados no momento
// em que entram numa lista.
let colunaOculto = null;
function garantirColunaOculto(q = dbQuery) {
  if (!colunaOculto) {
    colunaOculto = q('ALTER TABLE contacts ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT FALSE')
      .catch(() => { /* sem privilégio para ALTER: fica tudo visível, como antes */ });
  }
  return colunaOculto;
}

// Marca ou desmarca. Nunca esconde um contacto que já existia: só os ids que
// vêm de uma criação (ver upsertContactos), senão um ficheiro fazia
// desaparecer da listagem gente que lá estava por outra via.
async function marcarOculto(q, ids, oculto) {
  const lista = (Array.isArray(ids) ? ids : [ids]).map(Number).filter(Boolean);
  if (!lista.length) return;
  await garantirColunaOculto(q);
  try {
    await q('UPDATE contacts SET hidden=$1 WHERE id = ANY($2::int[])', [oculto === true, lista]);
  } catch (e) {
    if (e.code !== '42703') throw e;
  }
}

function normalizaEmail(v) {
  return String(v == null ? '' : v).toLowerCase().trim();
}

async function idsPorEmail(q, emails) {
  if (!emails.length) return new Map();
  // Antes da 051 o mesmo email pode existir em várias marcas. Fica o id mais
  // baixo — o mesmo que a migração escolhe ao fundir — para que o resultado
  // seja o mesmo antes e depois de a correr.
  const rows = await q(
    `SELECT DISTINCT ON (LOWER(email)) id, LOWER(email) AS email
     FROM contacts WHERE LOWER(email) = ANY($1::text[])
     ORDER BY LOWER(email), id`,
    [emails]
  );
  return new Map(rows.map(r => [r.email, r.id]));
}

/**
 * Cria ou actualiza contactos pelo email, sem marca.
 *
 * @param {Function} q  função de query (pode ser a de uma transacção)
 * @param {Array} linhas  [{ email, name, phone, company, source, status, created_at, custom_attributes }]
 * @param {Object} opcoes
 *   - respeitarSaida: não reactivar quem cancelou/foi devolvido (por omissão, sim)
 *   - fundirAtributos: juntar custom_attributes ao que já existe em vez de substituir
 * @returns {Promise<Array>} [{ email, id, criado }] pela ordem de entrada
 */
async function upsertContactos(q, linhas, opcoes = {}) {
  const { respeitarSaida = true, fundirAtributos = false, ocultarNovos = false } = opcoes;
  if (!Array.isArray(linhas) || !linhas.length) return [];
  await permitirContactosSemMarca(q);

  // Dois registos com o mesmo email no mesmo pedido são a mesma pessoa: o
  // último preenche o que faltava no primeiro.
  const porEmail = new Map();
  for (const l of linhas) {
    const email = normalizaEmail(l.email);
    const ant = porEmail.get(email);
    porEmail.set(email, ant ? { ...ant, ...Object.fromEntries(Object.entries(l).filter(([, v]) => v != null)), email } : { ...l, email });
  }
  const unicas = [...porEmail.values()];

  const mapa = await idsPorEmail(q, unicas.map(l => l.email));

  const aActualizar = unicas.filter(l => mapa.has(l.email));
  if (aActualizar.length) {
    const params = [];
    const vals = aActualizar.map(l => {
      params.push(
        mapa.get(l.email), l.name || null, l.phone || null, l.company || null,
        l.source || null, l.status || null, l.created_at || null,
        l.custom_attributes ? JSON.stringify(l.custom_attributes) : null
      );
      const n = params.length;
      return `($${n - 7}::int,$${n - 6}::text,$${n - 5}::text,$${n - 4}::text,$${n - 3}::text,$${n - 2}::contact_status,$${n - 1}::timestamptz,$${n}::jsonb)`;
    }).join(',');
    await q(
      `UPDATE contacts c SET
         name       = COALESCE(v.name, c.name),
         phone      = COALESCE(v.phone, c.phone),
         company    = COALESCE(v.company, c.company),
         source     = COALESCE(v.source, c.source),
         created_at = COALESCE(v.created_at, c.created_at),
         status     = CASE
           WHEN ${respeitarSaida ? `c.status::text IN (${ESTADOS_DE_SAIDA.map(s => `'${s}'`).join(',')})` : 'FALSE'}
             THEN c.status
           ELSE COALESCE(v.status, c.status)
         END,
         custom_attributes = ${fundirAtributos
        ? `CASE WHEN v.custom_attributes IS NOT NULL
                 THEN COALESCE(c.custom_attributes,'{}'::jsonb) || v.custom_attributes
                 ELSE c.custom_attributes END`
        : 'COALESCE(v.custom_attributes, c.custom_attributes)'},
         updated_at = NOW()
       FROM (VALUES ${vals}) AS v(id, name, phone, company, source, status, created_at, custom_attributes)
       WHERE c.id = v.id`,
      params
    );
  }

  const criados = new Set();
  const aInserir = unicas.filter(l => !mapa.has(l.email));
  if (aInserir.length) {
    const params = [];
    const vals = aInserir.map(l => {
      params.push(
        l.email, l.name || null, l.phone || null, l.company || null, l.source || null,
        l.status || null, l.created_at || null,
        l.custom_attributes ? JSON.stringify(l.custom_attributes) : null
      );
      const n = params.length;
      // COALESCE no status é indispensável: passar NULL explícito NÃO recorre
      // ao DEFAULT da coluna — grava NULL. E um contacto com status NULL fica
      // fora de todos os envios, porque o envio filtra por status='active'.
      return `($${n - 7}::text,$${n - 6}::text,$${n - 5}::text,$${n - 4}::text,$${n - 3}::text,`
        + `COALESCE($${n - 2}::contact_status,'active'),COALESCE($${n - 1}::timestamptz,NOW()),$${n}::jsonb)`;
    }).join(',');
    // ON CONFLICT sem alvo: não depende de nenhum índice em particular, por
    // isso funciona antes e depois de a 051 criar o índice único do email.
    const novos = await q(
      `INSERT INTO contacts (email, name, phone, company, source, status, created_at, custom_attributes)
       VALUES ${vals}
       ON CONFLICT DO NOTHING
       RETURNING id, LOWER(email) AS email`,
      params
    );
    novos.forEach(r => { mapa.set(r.email, r.id); criados.add(r.email); });
    // Quem não voltou perdeu a corrida com outro pedido em paralelo: o
    // contacto existe, foi só criado por outro.
    const faltam = aInserir.filter(l => !mapa.has(l.email)).map(l => l.email);
    if (faltam.length) {
      const recuperados = await idsPorEmail(q, faltam);
      recuperados.forEach((id, email) => mapa.set(email, id));
    }
  }

  const resultado = linhas.map(l => {
    const email = normalizaEmail(l.email);
    return { email, id: mapa.get(email) || null, criado: criados.has(email) };
  });

  // Só os criados agora. Quem já existia mantém a visibilidade que tinha.
  if (ocultarNovos) {
    await marcarOculto(q, resultado.filter(r => r.criado && r.id).map(r => r.id), true);
  }
  return resultado;
}

/**
 * Aplica à tabela contacts o estado que consta da lista de supressão.
 * Nunca reactiva ninguém: só mexe em contactos activos.
 */
async function aplicarSupressao(q, ids) {
  const lista = (Array.isArray(ids) ? ids : [ids]).map(Number).filter(Boolean);
  if (!lista.length) return;
  await q(
    `UPDATE contacts SET status = (CASE
         WHEN s.reason='unsubscribe' THEN 'unsubscribed'
         WHEN s.reason='bounce'      THEN 'bounced'
         WHEN s.reason='spam'        THEN 'complained'
         ELSE 'suppressed' END)::contact_status
     FROM suppression s
     WHERE contacts.id = ANY($1::int[])
       AND LOWER(contacts.email) = LOWER(s.email)
       AND contacts.status = 'active'`,
    [lista]
  );
}

module.exports = {
  ESTADOS_DE_SAIDA,
  garantirColunaOculto,
  marcarOculto,
  permitirContactosSemMarca,
  normalizaEmail,
  idsPorEmail,
  upsertContactos,
  aplicarSupressao,
  // só para testes
  _resetMigracao: () => { semMarcaGarantido = null; colunaOculto = null; },
};
