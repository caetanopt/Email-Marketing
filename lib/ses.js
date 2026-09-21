const { SESClient } = require('@aws-sdk/client-ses');

let client;

function getSESClient() {
  if (!client) {
    client = new SESClient({
      region: process.env.AWS_REGION || 'eu-west-1',
      credentials: {
        accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });
  }
  return client;
}

// Opções comuns a TODOS os comandos de envio.
//
// Um configuration set é o que faz o SES publicar os eventos de entrega,
// bounce, queixa e rejeição — e o que alimenta o painel de reputação da AWS.
// Sem ele, a única coisa que sabemos de um envio é que o SES aceitou a
// mensagem; o que lhe aconteceu depois chega-nos só pelas notificações de
// bounce e queixa, que é uma fracção do quadro.
//
// Fica a depender da variável de ambiente e NÃO tem valor por omissão de
// propósito: um ConfigurationSetName que não exista na conta faz o SES
// REJEITAR o envio inteiro (ConfigurationSetDoesNotExistException). Enquanto
// SES_CONFIGURATION_SET não estiver definida isto devolve um objecto vazio e
// os comandos ficam exactamente como estavam.
function opcoesDeEnvio() {
  const cs = process.env.SES_CONFIGURATION_SET;
  return cs ? { ConfigurationSetName: cs } : {};
}

module.exports = { getSESClient, opcoesDeEnvio };
