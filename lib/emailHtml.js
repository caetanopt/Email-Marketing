// Tratamento do HTML de um email na altura do envio: reescrita dos links
// para contagem de cliques e geração da versão em texto simples.
//
// Estava escrito três vezes (duas em api/campaigns/[id].js, uma em
// lib/sendCampaign.js) com pequenas diferenças entre si — o mesmo padrão que
// já tinha deixado passar bugs no rodapé e nas colunas.

// Reescreve os endereços dos links para passarem pelo /api/track.
//
// Só toca em <a href>. A versão anterior apanhava qualquer href="http..." do
// documento, incluindo o <link rel="stylesheet"> das fontes que a MJML põe no
// <head>: a folha de estilo passava a apontar para o redireccionador, a fonte
// nunca carregava e cada cliente que fosse buscá-la registava um clique que
// nunca aconteceu — a inflacionar as estatísticas da campanha.
function injectTracking(html, { appUrl, campaignId, contactId, token, utm }) {
  const base = String(appUrl || '').replace(/\/$/, '');
  const utmStr = utm || '';
  return String(html || '').replace(/<a\b[^>]*>/gi, (tag) => {
    return tag.replace(/(\shref=")(https?:\/\/[^"]+)(")/i, (attr, antes, bruto, depois) => {
      const url = bruto
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"');
      // O cancelamento de subscrição e os links já reescritos ficam como estão.
      if (url.includes('action=unsubscribe') || url.includes('action=resubscribe')) return attr;
      if (url.includes('/api/track?')) return attr;
      let dest = url;
      if (utmStr) dest += (dest.includes('?') ? '&' : '?') + utmStr;
      const redirect = `${base}/api/track?type=click&cid=${campaignId}&uid=${contactId}&t=${token}&url=${encodeURIComponent(dest)}`;
      return `${antes}${redirect}${depois}`;
    });
  });
}

// Versão em texto simples do email, para a parte text/plain da mensagem.
//
// A versão anterior limitava-se a tirar as tags, e o resultado era quase
// ilegível: começava com "96" — o valor de <o:PixelsPerInch>96</o:PixelsPerInch>
// que vive dentro de um comentário condicional do Outlook, e que não era
// removido — seguido de centenas de linhas só com espaços, vindas da
// indentação do HTML gerado pela MJML. A parte em texto simples conta para os
// filtros de spam e é o que alguns clientes mostram, por isso passa a ser
// tratada a sério: fora comentários e <head>, e linhas em branco colapsadas.
function htmlToText(html) {
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')                     // comentários, incluindo os condicionais do Outlook
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')        // <title>, <meta>, <style>, <link>
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6])>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#8217;/g, '’')
    .split('\n')
    .map(l => l.replace(/[ \t ]+/g, ' ').trim())    // espaços da indentação
    .filter((l, i, todas) => l !== '' || (i > 0 && todas[i - 1] !== ''))  // no máximo uma linha em branco seguida
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = { injectTracking, htmlToText };
