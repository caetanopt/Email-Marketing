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

// Fundo da área do disclaimer. Numa constante porque os ícones das redes
// também o declaram: um elemento sem fundo próprio deixa o browser pintar o
// seu (em modo escuro, branco no hover de um link).
const AREA_BG = '#f1f1f1';

// Largura do conteúdo do email. Os mesmos limites que o editor aplica.
const WIDTH_DEFAULT = 640;
const WIDTH_MIN = 320;
const WIDTH_MAX = 900;

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

// Ícone por omissão: o mesmo que a MJML usa no bloco "Redes Sociais". São
// ícones claros, pensados para fundos escuros, por isso praticamente
// desaparecem sobre o #f1f1f1 do rodapé — daí ser possível indicar, em
// Definições Globais → Rodapé legal, a imagem a usar em cada rede.
const SOCIAL_ICON_DEFAULT = (network) =>
  `https://www.mailjet.com/images/theme/v1/icons/ico-social/${network}.png`;

// Ordem fixa de apresentação, igual à do modelo.
const SOCIAL_NETWORKS = [
  ['facebook', 'Facebook'],
  ['instagram', 'Instagram'],
  ['youtube', 'YouTube'],
  ['linkedin', 'LinkedIn'],
  ['tiktok', 'TikTok'],
];

// Largura do conteúdo do email a que o rodapé vai ser anexado.
//
// O rodapé é montado no momento do envio, mas o HTML da campanha foi gerado
// quando foi gravada — e pode ter sido gravada com outra largura. Usar a
// definição actual deixava o rodapé mais largo (ou mais estreito) do que o
// email. Lê-se, por isso, a largura do próprio HTML:
//
//   - '...margin:0px auto;max-width:640px...'  é o que a MJML emite à volta
//     de cada secção;
//   - '...max-width:640px;width:100%...'       é o que o gerador de HTML de
//     recurso emite na tabela do conteúdo.
//
// Só se aceita um valor dentro dos limites; caso contrário devolve null e
// quem chama recorre à definição global.
function detectContentWidth(html) {
  const texto = String(html || '');
  const padroes = [
    /margin:\s*0px auto\s*;\s*max-width:\s*(\d{3,4})px/i,
    /max-width:\s*(\d{3,4})px\s*;\s*width:\s*100%/i,
  ];
  for (const re of padroes) {
    const m = texto.match(re);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    if (n >= WIDTH_MIN && n <= WIDTH_MAX) return n;
  }
  return null;
}

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
 * @param {string} [o.brandName]      nome da marca, para o alt do logótipo
 * @param {number} [o.year]             ano; por omissão o actual
 * @param {number|string} [o.width]     largura do conteúdo, em px; por omissão 640
 */
function buildLegalFooter(o = {}) {
  const vars = o.variables || {};
  // A largura vem de Definições Globais → Tipografia, para o rodapé ter a
  // mesma medida que o corpo do email. Validada aqui porque este valor entra
  // num atributo width e num max-width.
  const larguraPedida = parseInt(o.width, 10);
  const largura = (larguraPedida >= WIDTH_MIN && larguraPedida <= WIDTH_MAX) ? larguraPedida : WIDTH_DEFAULT;
  // A marca sobrepõe-se ao global; só quando o campo da marca está vazio é
  // que se usa o global.
  const textoDisclaimer = (vars.disclaimer || o.disclaimer || '').trim() || (o.globalDisclaimer || '').trim();

  // Redes sociais do rodapé: o ENDEREÇO vem sempre das variáveis da marca
  // (facebook, instagram, ...), que é onde já é gerido. O rodapé só define a
  // IMAGEM do ícone, porque a de origem é clara e não se vê no fundo cinzento.
  const footerSocials = o.footerSocials || {};
  const redes = SOCIAL_NETWORKS
    .map(([chave, nome]) => {
      const cfg = footerSocials[chave];
      // Guardado como { icon }. Um valor em texto é de um formato anterior, em
      // que representava o endereço do perfil — ignora-se, para não acabar
      // como src de uma imagem.
      const icone = String((cfg && typeof cfg === 'object' ? cfg.icon : '') || '').trim();
      return {
        chave, nome,
        href: String(vars[chave] || '').trim(),
        icon: /^https?:\/\//i.test(icone) ? icone : SOCIAL_ICON_DEFAULT(chave),
      };
    })
    .filter(r => /^https?:\/\//i.test(r.href));

  // Uma célula por rede, todas na mesma <tr>. Antes eram <a
  // display:inline-block> lado a lado, que o Outlook (motor do Word) não
  // suporta: tratava cada link como bloco e os ícones apareciam empilhados na
  // vertical. Uma linha de tabela é a única forma de garantir a horizontal em
  // todos os clientes.
  //
  // Cada célula e cada <a> declaram o fundo da área (AREA_BG) em vez de o
  // deixarem transparente. Sem isso, em modo escuro o browser pintava o
  // fundo por omissão do link ao passar o rato — o ícone ficava dentro de um
  // quadrado branco. Com a cor declarada não há fundo por omissão a aparecer.
  const iconesHtml = redes.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="right" bgcolor="${AREA_BG}" style="border-collapse:collapse;background:${AREA_BG}"><tr>${
        redes.map((r, i) =>
          `<td bgcolor="${AREA_BG}" style="padding:0 0 0 ${i === 0 ? 0 : 10}px;line-height:1;font-size:0;background:${AREA_BG}"><a href="${escHtml(r.href)}" target="_blank" style="text-decoration:none;background:${AREA_BG};color:inherit;-webkit-tap-highlight-color:transparent"><img src="${escHtml(r.icon)}" width="22" height="22" alt="${escHtml(r.nome)}" style="display:block;border:0;outline:none;text-decoration:none;background:${AREA_BG}"></a></td>`
        ).join('')
      }</tr></table>`
    : '';

  // Logótipo: a variável footer_logo da marca sobrepõe-se ao logótipo global,
  // para marcas como a Carplus ou a Caetano Parts que usam o seu no rodapé.
  // As variáveis da marca são guardadas sem validação, e este valor vai para o
  // src de uma <img> em todos os emails — por isso valida-se aqui, no ponto de
  // uso: só http(s), sem espaços nem caracteres que quebrem o atributo.
  const logoDaMarca = String(vars.footer_logo || '').trim();
  const logoUrl = (/^https?:\/\//i.test(logoDaMarca) && !/[<>"'\s]/.test(logoDaMarca))
    ? logoDaMarca
    : (o.footerLogoUrl || '');
  const logoHtml = logoUrl
    ? `<img src="${escHtml(logoUrl)}" alt="${escHtml(o.brandName || 'Caetano')}" height="22" style="display:block;border:0;max-height:22px">`
    : '';

  // A linha do logótipo/redes só existe se houver pelo menos um dos dois.
  // Três células alinhadas ao centro na vertical: logótipo à esquerda, barra a
  // separar (a célula do meio estica e leva um filete de 1px) e redes à
  // direita. A barra só entra quando existem os dois lados, senão não separava
  // nada. O filete é um <td> com altura fixa e fundo, que é a forma que os
  // clientes de email desenham de maneira previsível.
  const barraHtml = (logoHtml && iconesHtml)
    ? `<td style="padding:0 18px;vertical-align:middle"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="1" style="height:1px;line-height:1px;font-size:0;background:#d8d8d8">&nbsp;</td></tr></table></td>`
    : '';
  const linhaMarca = (logoHtml || iconesHtml)
    ? `<tr><td style="padding:22px 0 0">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td align="left" width="1" style="vertical-align:middle;white-space:nowrap">${logoHtml}</td>
        ${barraHtml}
        <td align="right" width="1" style="vertical-align:middle;white-space:nowrap">${iconesHtml}</td>
      </tr></table>
    </td></tr>`
    : '';

  // A área cinzenta só aparece se tiver conteúdo. Sem padding lateral na
  // célula exterior: a área ocupa toda a largura do conteúdo do email (600px),
  // em vez de ficar encolhida 20px de cada lado.
  const areaCinza = (textoDisclaimer || linhaMarca)
    ? `<tr><td style="padding:0 0 8px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${AREA_BG}" style="background:${AREA_BG};background-color:${AREA_BG};border-radius:0 0 10px 10px">
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
    <table role="presentation" width="${largura}" cellpadding="0" cellspacing="0" border="0" style="max-width:${largura}px;width:100%">
      ${areaCinza}
      <tr><td align="center" style="padding:18px 28px 6px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.2;color:#8a8a8a">${frase}</td></tr>
      <tr><td align="center" style="padding:0 28px 24px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.2;color:#8a8a8a">${links}</td></tr>
    </table>
  </td></tr>
</table>`;
}

// Valida as imagens dos ícones do rodapé antes de as gravar. Só se aceitam as
// redes conhecidas e endereços http(s) sem espaços nem caracteres que quebrem
// o atributo — o valor vai para o src de uma <img> em todos os emails.
//
// Guarda-se { icon } por rede. O endereço do perfil não vive aqui: vem das
// variáveis da marca, onde já é gerido.
function sanitizeFooterSocials(input) {
  const permitidas = SOCIAL_NETWORKS.map(([chave]) => chave);
  const out = {};
  if (!input || typeof input !== 'object') return out;
  const urlOk = (v) => /^https?:\/\//i.test(v) && v.length <= 500 && !/[<>"'\s]/.test(v);
  for (const chave of permitidas) {
    const bruto = input[chave];
    // Um valor em texto é de um formato anterior, em que representava o
    // endereço do perfil — descarta-se, para não passar a ser lido como imagem.
    const icon = String((bruto && typeof bruto === 'object' ? bruto.icon : '') || '').trim();
    if (!icon || !urlOk(icon)) continue;
    out[chave] = { icon };
  }
  return out;
}

module.exports = { buildLegalFooter, detectContentWidth, sanitizeDisclaimer, sanitizeFooterSocials, SOCIAL_NETWORKS, PRIVACY_URL };
