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

module.exports = {
  garantirColunaRodapeLegal,
  lerRodapeLegal,
  semRodapeLegal,
  gravarRodapeLegal,
  // só para testes
  _resetMigracao: () => { colunaGarantida = null; },
};
