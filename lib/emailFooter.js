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

const sanitizeHtml = require('sanitize-html');

const PRIVACY_URL = 'https://caetano.pt/politica-privacidade/';

// Sanitização do disclaimer, que agora aceita formatação (negrito, itálico,
// sublinhado, links). Corre no servidor porque a API pode ser chamada
// directamente, sem passar pelo editor — e este conteúdo vai para dentro de
// todos os emails enviados em nome da marca.
//
// Usa-se a biblioteca sanitize-html em vez de uma limpeza feita à mão: é
// exactamente aqui que os sanitizadores caseiros falham.
const DISCLAIMER_SANITIZE = {
  allowedTags: ['b', 'strong', 'i', 'em', 'u', 'br', 'span', 'sup', 'sub', 'a'],
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
    span: ['style'],
  },
  // javascript:, data: e afins ficam de fora; o href é removido e o texto mantém-se.
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesAppliedToAttributes: ['href'],
  allowedStyles: {
    span: {
      color: [/^#[0-9a-f]{3,8}$/i, /^rgb\(/i],
      'font-size': [/^\d{1,3}(px|pt|em|rem|%)$/i],
      'font-weight': [/^(bold|bolder|normal|[1-9]00)$/i],
      'font-style': [/^(italic|normal)$/i],
      'text-decoration': [/^(underline|none|line-through)$/i],
    },
  },
  // Um link no rodapé de um email deve abrir fora do cliente de email.
  transformTags: {
    a: (tagName, attribs) => ({
      tagName: 'a',
      attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer' },
    }),
  },
  disallowedTagsMode: 'discard',
};

function sanitizeDisclaimer(html) {
  // As tags de bloco não são permitidas, mas representam mudanças de linha:
  // converte-se o fecho de cada uma em <br> antes de as descartar, senão
  // "<div>a</div><div>b</div>" ficava "ab". O editor já faz esta conversão,
  // isto cobre quem chame a API directamente.
  const comQuebras = String(html == null ? '' : html)
    .replace(/<\/(div|p|li|h[1-6]|blockquote|tr)\s*>/gi, '<br>');
  return sanitizeHtml(comQuebras, DISCLAIMER_SANITIZE)
    // Um href rejeitado (javascript:, data:, ...) deixa um <a> sem endereço:
    // desembrulha-se, para não ficar marcação morta no email. O sanitize-html
    // garante que estas tags estão bem formadas e os links não se aninham.
    .replace(/<a(?![^>]*\shref=)[^>]*>([\s\S]*?)<\/a>/gi, '$1')
    .replace(/(?:\s*<br\s*\/?>\s*)+$/i, '') // sem quebras penduradas no fim
    .trim();
}

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

// O disclaimer pode vir em dois formatos: HTML com formatação (o que o editor
// grava desde que passou a ter negrito/itálico/links) ou texto simples, que é
// o que está gravado nos registos anteriores a essa alteração. Distinguem-se
// pela presença de marcação: sem tags, trata-se como texto (escapa-se e
// convertem-se as mudanças de linha); com tags, sanitiza-se.
//
// Em qualquer dos casos o resultado passa pelo sanitizador ou pelo escape —
// nunca se confia no valor tal como está gravado.
function disclaimerToHtml(valor) {
  const texto = String(valor).trim();
  const pareceHtml = /<[a-z][\s\S]*>/i.test(texto);
  return pareceHtml
    ? sanitizeDisclaimer(texto)
    : escHtml(texto).replace(/\r?\n/g, '<br>');
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

  // Redes sociais do rodapé: os links próprios do rodapé (Definições Globais →
  // Rodapé legal) têm prioridade, porque existem precisamente para esta área.
  // Quando não estão preenchidos, recorre-se às variáveis da marca, mantendo o
  // comportamento anterior para quem já as tinha configuradas.
  const footerSocials = o.footerSocials || {};
  const redes = SOCIAL_NETWORKS
    .map(([chave, nome]) => {
      const doRodape = String(footerSocials[chave] || '').trim();
      const daMarca = String(vars[chave] || '').trim();
      return { chave, nome, href: /^https?:\/\//i.test(doRodape) ? doRodape : daMarca };
    })
    .filter(r => /^https?:\/\//i.test(r.href));

  const iconesHtml = redes.map(r =>
    `<a href="${escHtml(r.href)}" target="_blank" style="display:inline-block;margin-left:8px;text-decoration:none"><img src="${SOCIAL_ICON(r.chave)}" width="28" height="28" alt="${escHtml(r.nome)}" style="display:block;border:0;border-radius:50%"></a>`
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

  // A área cinzenta só aparece se tiver conteúdo. Sem padding lateral na
  // célula exterior: a área ocupa toda a largura do conteúdo do email (600px),
  // em vez de ficar encolhida 20px de cada lado.
  const areaCinza = (textoDisclaimer || linhaMarca)
    ? `<tr><td style="padding:0 0 8px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f1f1f1" style="background:#f1f1f1;background-color:#f1f1f1;border-radius:10px">
        <tr><td style="padding:26px 28px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            ${textoDisclaimer ? `<tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:10px;line-height:1.2;text-align:left;color:#999999">${disclaimerToHtml(textoDisclaimer)}</td></tr>` : ''}
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

// Valida os links das redes sociais do rodapé antes de os gravar. Só se
// aceitam as redes conhecidas e endereços http(s) — o valor vai para o href de
// uma <a> em todos os emails.
function sanitizeFooterSocials(input) {
  const permitidas = SOCIAL_NETWORKS.map(([chave]) => chave);
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const chave of permitidas) {
    const v = String(input[chave] == null ? '' : input[chave]).trim();
    if (!v) continue;
    if (!/^https?:\/\//i.test(v) || v.length > 500) continue;
    if (/[<>"'\s]/.test(v)) continue;
    out[chave] = v;
  }
  return out;
}

module.exports = { buildLegalFooter, sanitizeDisclaimer, sanitizeFooterSocials, SOCIAL_NETWORKS, PRIVACY_URL };
