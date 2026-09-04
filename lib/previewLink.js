// Link da "Versão web" de uma campanha.
//
// O endereço era
//   https://emkt.caetano.pt/api/preview?id=74&token=<64 caracteres hex>
// com cerca de 115 caracteres — o suficiente para partir em duas linhas em
// muitos clientes de email e para ser desagradável de partilhar. Passa a
//   https://emkt.caetano.pt/v/74/<16 caracteres>
// com cerca de 45.
//
// O que encolhe é a representação do token, não a sua função: continua a ser
// um HMAC-SHA256 da campanha com o JWT_SECRET, mas truncado a 12 bytes e
// escrito em base64url em vez dos 32 bytes em hexadecimal. Truncar um HMAC é
// prática corrente (a própria RFC 2104 a prevê, e o HOTP trunca bem mais);
// 96 bits continuam a tornar inviável adivinhar o link de uma campanha.
//
// Os emails já enviados levam o formato antigo, por isso o token de 64
// caracteres continua a ser aceite — a validação conhece os dois.

const crypto = require('crypto');

const SEGREDO = () => process.env.JWT_SECRET || '';
const BYTES_CURTO = 12;

function hmac(campaignId) {
  return crypto.createHmac('sha256', SEGREDO()).update(`preview:${campaignId}`).digest();
}

// Token actual: 12 bytes em base64url = 16 caracteres, sem nada que precise
// de ser escapado num URL.
function previewToken(campaignId) {
  return hmac(campaignId).subarray(0, BYTES_CURTO).toString('base64url');
}

// Token do formato anterior, mantido só para validar links já enviados.
function previewTokenLegacy(campaignId) {
  return hmac(campaignId).toString('hex');
}

function iguais(a, b) {
  try {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
  } catch (_) { return false; }
}

// Aceita o token novo e o antigo. A comparação é feita em tempo constante e
// os dois formatos são sempre testados, para o tempo de resposta não dizer
// qual deles falhou.
function previewTokenValido(campaignId, token) {
  if (!token || !SEGREDO()) return false;
  const curto = iguais(token, previewToken(campaignId));
  const antigo = iguais(token, previewTokenLegacy(campaignId));
  return curto || antigo;
}

function previewUrl(appUrl, campaignId) {
  const base = String(appUrl || '').replace(/\/$/, '');
  return `${base}/v/${campaignId}/${previewToken(campaignId)}`;
}

module.exports = { previewToken, previewTokenLegacy, previewTokenValido, previewUrl };
