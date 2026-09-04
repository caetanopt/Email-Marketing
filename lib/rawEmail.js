// Montagem da mensagem MIME e os cabeçalhos de cancelamento de subscrição.
//
// buildRawEmail estava escrito duas vezes, igual, em lib/sendCampaign.js e
// api/campaigns/[id].js.

// Cabeçalhos de cancelamento de subscrição.
//
// Desde Fevereiro de 2024 o Gmail e o Yahoo exigem-nos a quem envia em
// volume. Sem eles, além de pior colocação na caixa de entrada, não aparece
// o "Cancelar subscrição" ao lado do remetente no Gmail — o que empurra
// quem quer sair para o botão de spam, que custa muito mais à reputação do
// domínio do que um cancelamento.
//
// O List-Unsubscribe-Post declara que o endereço aceita um POST e cancela
// sem mais confirmação (RFC 8058). Só se declara porque é verdade: o
// /api/suppression?action=unsubscribe aceita POST, valida o token e responde
// 200. Declará-lo sem isso seria pior do que não o declarar — o cliente de
// email diria à pessoa que a subscrição foi cancelada e ela continuaria
// inscrita.
function listUnsubscribeHeaders(unsubUrl) {
  const url = String(unsubUrl || '').trim();
  if (!/^https?:\/\//i.test(url)) return {};
  return {
    'List-Unsubscribe': `<${url}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

function buildRawEmail({ fromName, fromEmail, toEmail, replyTo, subject, htmlBody, textBody, attachments, headers }) {
  const boundary = `==PM${Date.now()}${Math.random().toString(36).slice(2)}==`;
  const altBoundary = `==ALT${Date.now()}${Math.random().toString(36).slice(2)}==`;
  const encodeB = s => '=?UTF-8?B?' + Buffer.from(s, 'utf8').toString('base64') + '?=';
  const needsEncode = s => /[^\x20-\x7E]/.test(s);
  const hdrSubject = needsEncode(subject) ? encodeB(subject) : subject;
  const hdrFrom = needsEncode(fromName)
    ? `${encodeB(fromName)} <${fromEmail}>`
    : `${fromName} <${fromEmail}>`;

  // Cabeçalhos extra. Um valor com mudança de linha permitiria injectar
  // cabeçalhos na mensagem, por isso qualquer CR/LF é recusado — nenhum dos
  // cabeçalhos que aqui passam os pode legitimamente conter.
  const extra = Object.entries(headers || {})
    .filter(([nome, valor]) => /^[A-Za-z][A-Za-z0-9-]*$/.test(nome) && !/[\r\n]/.test(String(valor)))
    .map(([nome, valor]) => `${nome}: ${valor}`);

  const lines = [
    `MIME-Version: 1.0`,
    `From: ${hdrFrom}`,
    `To: ${toEmail}`,
    `Subject: ${hdrSubject}`,
    ...(replyTo ? [`Reply-To: ${replyTo}`] : []),
    ...extra,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    ``,
    `--${altBoundary}`,
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    Buffer.from(textBody, 'utf8').toString('base64'),
    ``,
    `--${altBoundary}`,
    `Content-Type: text/html; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    Buffer.from(htmlBody, 'utf8').toString('base64'),
    ``,
    `--${altBoundary}--`,
  ];

  for (const att of (attachments || [])) {
    const fname = needsEncode(att.name) ? encodeB(att.name) : att.name;
    lines.push(
      `--${boundary}`,
      `Content-Type: ${att.type || 'application/octet-stream'}; name="${fname}"`,
      `Content-Disposition: attachment; filename="${fname}"`,
      `Content-Transfer-Encoding: base64`,
      ``,
      att.data,  // já vem base64 do browser
      ``
    );
  }
  lines.push(`--${boundary}--`);
  return lines.join('\r\n');
}

module.exports = { buildRawEmail, listUnsubscribeHeaders };
