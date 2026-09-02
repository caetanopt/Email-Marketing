// Rodapé legal acrescentado automaticamente a todos os envios.
//
// Vive num módulo próprio porque tem de sair exactamente igual em três
// caminhos diferentes: o envio real (lib/sendCampaign.js), o envio de teste
// (api/campaigns/[id].js) e a pré-visualização web (api/track.js). Antes o
// rodapé era montado à mão em cada um deles e divergia.
//
// Estrutura (a mesma do modelo aprovado):
//   [ área #f1f1f1 ]  texto do disclaimer
//                     logótipo do grupo (esquerda) | redes sociais (direita)
//   [ fora da área ]  frase legal com o email e o ano preenchidos
//                     Política de privacidade | Versão web | Cancelar subscrição

const PRIVACY_URL = 'https://caetano.pt/politica-privacidade/';

// Mesmos ícones usados pelo bloco "Redes Sociais" do editor (e por omissão
// pela própria MJML), para o rodapé não ter um estilo diferente do corpo.
const SOCIAL_ICON = (network) =>
  `https://www.mailjet.com/images/theme/v1/icons/ico-social/${network}.png`;

// Ordem fixa de apresentação, igual à do modelo.
const SOCIAL_NETWORKS = [
  ['facebook', 'Facebook'],
  ['instagram', 'Instagram'],
  ['youtube', 'YouTube'],
  ['linkedin', 'LinkedIn'],
  ['tiktok', 'TikTok'],
];

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// O disclaimer é texto escrito pelo utilizador nas definições: escapa-se o
// HTML e convertem-se as mudanças de linha em <br>, para poder ser escrito em
// parágrafos sem que se possa injectar marcação.
function disclaimerToHtml(texto) {
  return escHtml(String(texto).trim()).replace(/\r?\n/g, '<br>');
}

/**
 * @param {object} o
 * @param {string} [o.disclaimer]       disclaimer da marca (tem prioridade)
 * @param {string} [o.globalDisclaimer] disclaimer global (usado se o da marca estiver vazio)
 * @param {string} [o.footerLogoUrl]    logótipo do grupo, à esquerda
 * @param {object} [o.variables]        variáveis da marca (redes sociais)
 * @param {string} [o.email]            email do destinatário, para a frase legal
 * @param {string} [o.unsubUrl]         link de cancelamento de subscrição
 * @param {string} [o.previewUrl]       link da versão web
 * @param {number} [o.year]             ano; por omissão o actual
 */
function buildLegalFooter(o = {}) {
  const vars = o.variables || {};
  // A marca sobrepõe-se ao global; só quando o campo da marca está vazio é
  // que se usa o global.
  const textoDisclaimer = (vars.disclaimer || o.disclaimer || '').trim() || (o.globalDisclaimer || '').trim();

  const redes = SOCIAL_NETWORKS
    .map(([chave, nome]) => ({ nome, href: String(vars[chave] || '').trim() }))
    .filter(r => /^https?:\/\//i.test(r.href));

  const iconesHtml = redes.map(r =>
    `<a href="${escHtml(r.href)}" target="_blank" style="display:inline-block;margin-left:8px;text-decoration:none"><img src="${SOCIAL_ICON(SOCIAL_NETWORKS.find(([, n]) => n === r.nome)[0])}" width="28" height="28" alt="${escHtml(r.nome)}" style="display:block;border:0;border-radius:50%"></a>`
  ).join('');

  const logoHtml = o.footerLogoUrl
    ? `<img src="${escHtml(o.footerLogoUrl)}" alt="Caetano" height="34" style="display:block;border:0;max-height:34px">`
    : '';

  // A linha do logótipo/redes só existe se houver pelo menos um dos dois.
  const linhaMarca = (logoHtml || iconesHtml)
    ? `<tr><td style="padding:22px 0 0">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td align="left" style="vertical-align:middle">${logoHtml}</td>
        <td align="right" style="vertical-align:middle">${iconesHtml}</td>
      </tr></table>
    </td></tr>`
    : '';

  // A área cinzenta só aparece se tiver conteúdo.
  const areaCinza = (textoDisclaimer || linhaMarca)
    ? `<tr><td style="padding:0 20px 8px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f1f1f1" style="background:#f1f1f1;background-color:#f1f1f1;border-radius:10px">
        <tr><td style="padding:26px 28px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            ${textoDisclaimer ? `<tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.65;color:#8a8a8a">${disclaimerToHtml(textoDisclaimer)}</td></tr>` : ''}
            ${linhaMarca}
          </table>
        </td></tr>
      </table>
    </td></tr>`
    : '';

  const ano = o.year || new Date().getFullYear();
  const emailTxt = escHtml(o.email || '');
  const frase = `Este e-mail foi enviado para ${emailTxt ? `<a href="mailto:${emailTxt}" style="color:#8a8a8a;text-decoration:underline">${emailTxt}</a>` : '—'} por © ${ano} Caetano Automotive Portugal, S.A., com sede na Rua do Barreiro 547, 4409-513 Vila Nova de Gaia, matriculada na CRCOM.VNGAIA com o Nº/NIPC 500003165.`;

  const link = (href, texto) =>
    `<a href="${escHtml(href)}" target="_blank" style="color:#8a8a8a;text-decoration:underline">${texto}</a>`;
  const links = [
    link(PRIVACY_URL, 'Política de privacidade'),
    o.previewUrl ? link(o.previewUrl, 'Versão web') : null,
    o.unsubUrl ? link(o.unsubUrl, 'Cancelar subscrição') : null,
  ].filter(Boolean).join(' <span style="color:#c4c4c4">|</span> ');

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%">
  <tr><td align="center" style="padding:0">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%">
      ${areaCinza}
      <tr><td align="center" style="padding:18px 28px 6px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#8a8a8a">${frase}</td></tr>
      <tr><td align="center" style="padding:0 28px 24px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#8a8a8a">${links}</td></tr>
    </table>
  </td></tr>
</table>`;
}

module.exports = { buildLegalFooter, PRIVACY_URL };
