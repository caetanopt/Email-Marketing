// Opções de campanha que afectam o email enviado.
//
// Por agora só uma: desligar o bloco legal do rodapé — a frase com o
// remetente e a sede da empresa, e a linha de links (Política de privacidade,
// Versão web, Cancelar subscrição). Vive num módulo próprio porque tem de ser
// lida da mesma maneira nos quatro caminhos que montam o rodapé — envio real,
// envio de teste, pré-visualização no ecrã e versão web — e escrita nos dois
// que gravam a campanha.
//
// A coluna na base de dados continua a chamar-se no_legal_notice.

const { query: dbQuery } = require('./db');

// A coluna é criada à primeira gravação que precise dela, uma vez por
// instância. A migração 052 faz o mesmo; isto é para o código funcionar antes
// de ela correr.
let colunaGarantida = null;
function garantirColunaRodapeLegal(q = dbQuery) {
  if (!colunaGarantida) {
    colunaGarantida = q('ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS no_legal_notice BOOLEAN NOT NULL DEFAULT FALSE')
      .catch(() => { /* sem privilégio para ALTER: a opção fica indisponível, o envio continua */ });
  }
  return colunaGarantida;
}

// Uma campanha sem a coluna (ou com ela a false) leva o rodapé legal
// completo: o comportamento por omissão é sempre enviá-lo.
function semRodapeLegal(campanha) {
  return campanha ? campanha.no_legal_notice === true : false;
}

// Grava a opção. Não vai no INSERT da criação de propósito: esse INSERT tem
// caminhos alternativos para bases de dados sem as colunas mais recentes, e
// juntar-lhe outra coluna multiplicava-os. Aqui é um UPDATE à parte, que falha
// em silêncio se a coluna não existir.
async function gravarRodapeLegal(id, valor, q = dbQuery) {
  if (valor === undefined || valor === null) return;
  await garantirColunaRodapeLegal(q);
  try {
    await q('UPDATE campaigns SET no_legal_notice=$1 WHERE id=$2', [valor === true, id]);
  } catch (e) {
    if (e.code !== '42703') throw e;
  }
}

// Para os caminhos cuja consulta não traz a coluna (a versão web escolhe as
// colunas uma a uma). Sem a coluna — migração 052 ainda não corrida — devolve
// false, que é enviar o rodapé legal.
async function lerRodapeLegal(id, q = dbQuery) {
  try {
    const rows = await q('SELECT no_legal_notice FROM campaigns WHERE id=$1', [id]);
    return rows[0]?.no_legal_notice === true;
  } catch (e) {
    if (e.code === '42703') return false;
    throw e;
  }
}

// ── Barreira antes de cada lote de envio ───────────────────────────────────
//
// Os destinatários de uma campanha são preparados antes do envio começar, e um
// envio grande demora vários lotes. Entre a preparação e o lote a pessoa pode
// ter cancelado — pelo link do email, pela API ou à mão na aplicação.
//
// Verificam-se as duas formas de estar cancelado, porque não andam sempre
// juntas:
//   - o email na tabela suppression (o link do email põe-o lá, e há também
//     supressões de domínio inteiro, gravadas como @dominio.pt);
//   - o estado do próprio contacto, que é o que muda quando o estado é
//     alterado na aplicação sem passar pelo link — esse caso não chegava à
//     tabela de supressão e o envio seguia.
//
// Vive aqui porque corre nos dois motores de envio (lib/sendCampaign.js e
// api/campaigns/[id].js) e já divergiu uma vez: um verificava o que o outro
// não verificava.
const ESTADOS_QUE_NAO_RECEBEM = ['unsubscribed', 'bounced', 'suppressed', 'complained'];

// Escrito com IN (SELECT …) e sem alias na tabela do UPDATE, em vez de
// EXISTS correlacionado: é o mesmo predicado, é a mesma forma que o filtro dos
// destinatários directos já usa em api/campaigns/[id].js, e permite correr
// este SQL a sério contra dados de exemplo num Postgres em memória.
const EMAIL_SUPRIMIDO = `lower(email) IN (SELECT lower(email) FROM suppression WHERE email NOT LIKE '@%')`;
const DOMINIO_SUPRIMIDO = `'@'||split_part(lower(email),'@',2) IN (SELECT lower(email) FROM suppression WHERE email LIKE '@%')`;
const SUPRIMIDO = `(${EMAIL_SUPRIMIDO} OR ${DOMINIO_SUPRIMIDO})`;
const CANCELADO = `contact_id IN (SELECT id FROM contacts WHERE status::text IN (${ESTADOS_QUE_NAO_RECEBEM.map(e => `'${e}'`).join(',')}))`;

async function bloquearCancelados(campaignId, q = dbQuery) {
  const onde = `WHERE campaign_id=$1 AND status IN ('pending','retry')
         AND (${SUPRIMIDO} OR ${CANCELADO})`;
  try {
    return await q(
      `UPDATE campaign_recipients
       SET status='failed', attempted_at=NOW(),
           error_message = CASE WHEN ${SUPRIMIDO}
             THEN 'Endereço na lista de supressão'
             ELSE 'Contacto cancelou a subscrição ou foi devolvido' END
       ${onde}`,
      [campaignId]
    );
  } catch (e) {
    // 42703: base de dados sem as colunas attempted_at/error_message.
    if (e.code !== '42703') throw e;
    return q(`UPDATE campaign_recipients SET status='failed' ${onde}`, [campaignId]);
  }
}

module.exports = {
  ESTADOS_QUE_NAO_RECEBEM,
  bloquearCancelados,
  garantirColunaRodapeLegal,
  lerRodapeLegal,
  semRodapeLegal,
  gravarRodapeLegal,
  // só para testes
  _resetMigracao: () => { colunaGarantida = null; },
};
