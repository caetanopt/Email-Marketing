// Validação criptográfica das mensagens do Amazon SNS.
//
// Porquê: /api/webhooks recebia eventos de entrega e agia sobre eles —
// inserindo na tabela de supressão e mudando o estado de contactos — com a
// única barreira de um segredo em query string, e mesmo essa só quando a
// variável de ambiente estivesse definida. Não estando, um POST anónimo
// suprimia qualquer endereço, globalmente e em todas as marcas.
//
// A assinatura resolve isso sem depender de nenhum segredo partilhado: cada
// mensagem SNS vem assinada com a chave privada da Amazon e traz o URL do
// certificado público correspondente.
//
// ATENÇÃO ao que a assinatura NÃO prova: prova que a mensagem veio do SNS,
// não que veio da NOSSA conta. Qualquer pessoa pode criar um tópico na conta
// AWS dela, inscrever este endpoint e publicar mensagens genuinamente
// assinadas. É por isso que existe também a verificação do TopicArn — as duas
// juntas é que fecham a porta.

const crypto = require('crypto');

// O certificado só pode vir de um host do próprio SNS. Sem isto, o campo
// SigningCertURL é um SSRF e um atacante indica o certificado dele.
const HOST_CERT = /^sns\.[a-z0-9-]+\.amazonaws\.com$/;

// Os campos que entram na assinatura, por tipo de mensagem, na ordem exacta
// definida pela AWS. A ordem faz parte do protocolo: trocá-la invalida tudo.
const CAMPOS = {
  Notification: ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'],
  SubscriptionConfirmation: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
  UnsubscribeConfirmation: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
};

// Uma mensagem com mais de uma hora é recusada: limita a janela de repetição
// de uma mensagem legítima capturada.
const IDADE_MAXIMA_MS = 60 * 60 * 1000;

// Cache dos certificados por URL, na memória da instância serverless. Sem
// isto, cada evento de entrega custava um pedido HTTPS à Amazon.
const _certs = new Map();

async function obterCertificado(url, buscar) {
  if (_certs.has(url)) return _certs.get(url);
  const resposta = await buscar(url);
  if (!resposta.ok) throw new Error('certificado inacessível (' + resposta.status + ')');
  const pem = await resposta.text();
  if (!/-----BEGIN CERTIFICATE-----/.test(pem)) throw new Error('resposta não é um certificado');
  _certs.set(url, pem);
  return pem;
}

// A string canónica é a concatenação de "campo\nvalor\n" para os campos
// presentes, pela ordem da tabela acima. Campos ausentes são saltados — o
// Subject só existe quando a mensagem o traz.
function stringCanonica(msg) {
  const campos = CAMPOS[msg.Type];
  if (!campos) throw new Error('tipo de mensagem desconhecido: ' + msg.Type);
  let out = '';
  for (const campo of campos) {
    if (msg[campo] === undefined || msg[campo] === null) continue;
    out += campo + '\n' + msg[campo] + '\n';
  }
  return out;
}

/**
 * Verifica uma mensagem SNS. Devolve { valido, motivo, topicArn }.
 *
 * Nunca lança: qualquer falha devolve valido:false com o motivo, para o
 * chamador poder responder 403 e registar a razão.
 *
 * @param msg     corpo já em objecto
 * @param opcoes  { arnsPermitidos, buscar, agora }
 */
async function verificarMensagemSns(msg, opcoes = {}) {
  const buscar = opcoes.buscar || globalThis.fetch;
  const agora = opcoes.agora || Date.now();

  if (!msg || typeof msg !== 'object') return { valido: false, motivo: 'corpo vazio' };

  // Sem envelope SNS não há assinatura possível. É este o formato que um
  // atacante usa hoje — o corpo cru do evento SES, sem Type nem Signature —
  // e a AWS nunca o entrega assim a um endpoint HTTPS.
  if (!msg.Type || !msg.Signature) return { valido: false, motivo: 'mensagem sem envelope SNS assinado' };
  if (!CAMPOS[msg.Type]) return { valido: false, motivo: 'tipo de mensagem desconhecido' };

  let urlCert;
  try { urlCert = new URL(msg.SigningCertURL || ''); }
  catch { return { valido: false, motivo: 'SigningCertURL inválido' }; }
  if (urlCert.protocol !== 'https:' || !HOST_CERT.test(urlCert.hostname)) {
    return { valido: false, motivo: 'SigningCertURL não é do SNS: ' + urlCert.hostname };
  }

  const ts = Date.parse(msg.Timestamp || '');
  if (!isNaN(ts) && Math.abs(agora - ts) > IDADE_MAXIMA_MS) {
    return { valido: false, motivo: 'mensagem fora da janela de tempo' };
  }

  // SignatureVersion 1 usa SHA1, a 2 usa SHA256. Qualquer outro valor é
  // recusado em vez de assumido.
  const algoritmo = msg.SignatureVersion === '1' ? 'RSA-SHA1'
    : msg.SignatureVersion === '2' ? 'RSA-SHA256'
    : null;
  if (!algoritmo) return { valido: false, motivo: 'SignatureVersion não suportada: ' + msg.SignatureVersion };

  let pem;
  try { pem = await obterCertificado(urlCert.href, buscar); }
  catch (e) { return { valido: false, motivo: 'certificado: ' + e.message }; }

  let assinaturaOk = false;
  try {
    const v = crypto.createVerify(algoritmo);
    v.update(stringCanonica(msg), 'utf8');
    assinaturaOk = v.verify(pem, msg.Signature, 'base64');
  } catch (e) {
    return { valido: false, motivo: 'verificação falhou: ' + e.message };
  }
  if (!assinaturaOk) return { valido: false, motivo: 'assinatura não corresponde' };

  // A assinatura prova que veio do SNS. Falta provar que veio do nosso
  // tópico: sem isto, um tópico criado na conta AWS de outra pessoa produz
  // mensagens igualmente válidas.
  const permitidos = (opcoes.arnsPermitidos || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  if (permitidos.length && !permitidos.includes(msg.TopicArn)) {
    return { valido: false, motivo: 'TopicArn não autorizado: ' + msg.TopicArn, topicArn: msg.TopicArn };
  }

  return { valido: true, motivo: '', topicArn: msg.TopicArn, arnsConfigurados: permitidos.length > 0 };
}

module.exports = { verificarMensagemSns, stringCanonica, HOST_CERT };
