const { query, transaction } = require('../lib/db');
const { buildLegalFooter, detectContentWidth } = require('../lib/emailFooter');
const { lerRodapeLegal } = require('../lib/campanhas');
const { previewTokenValido } = require('../lib/previewLink');
const { stripEditorMetadata, updateSocialIcons } = require('../lib/emailHtml');
const { verificarMensagemSns, HOST_CERT } = require('../lib/snsSignature');
const APP_URL_PREVIEW = (process.env.APP_URL || 'https://emkt.caetano.pt').replace(/\/$/, '');
const crypto = require('crypto');

const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

function trackToken(campaignId, contactId) {
  return crypto.createHmac('sha256', process.env.JWT_SECRET)
    .update(`track:${campaignId}:${contactId}`)
    .digest('hex');
}

// Destino de um clique. Devolve o URL normalizado se for um endereço web
// legítimo, ou null.
//
// O teste anterior era `url.startsWith('http')`, que aceitava `httpx://` e
// qualquer string começada por "http" — e, pior, o valor em bruto era gravado
// em email_events.url e reimpresso no relatório da campanha. Passar pelo
// construtor URL garante três coisas de uma vez: que é mesmo um endereço, que
// o esquema é http(s) (fora javascript: e data:), e que não leva CR/LF que
// pudesse partir o cabeçalho Location.
const LIMITE_URL = 2048;
function destinoSeguro(bruto) {
  if (!bruto || typeof bruto !== 'string') return null;
  if (bruto.length > LIMITE_URL) return null;
  let u;
  try { u = new URL(bruto); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  return u.href;
}

// O destino pertence mesmo a esta campanha?
//
// Devolve o destino se sim, ou '/' se não. Compara por HOST: o injectTracking
// acrescenta parâmetros UTM ao endereço, e há templates com links montados a
// partir de variáveis do contacto — comparar o URL inteiro recusaria links
// legítimos. Contra phishing o que conta é o domínio que a pessoa vê.
//
// Uma campanha SEM destinos registados não é validada. É o que mantém a
// funcionar os links das campanhas enviadas antes da migração 064, que estão
// nas caixas de correio das pessoas e não se podem invalidar.
async function destinoDaCampanha(campaignId, dest) {
  let host;
  try { host = new URL(dest).hostname.toLowerCase(); } catch { return '/'; }
  try {
    const linhas = await query(
      'SELECT 1 FROM campaign_links WHERE campaign_id=$1 LIMIT 1', [campaignId]
    );
    if (!linhas.length) return dest;   // campanha sem registo: comportamento antigo
    const casa = await query(
      'SELECT 1 FROM campaign_links WHERE campaign_id=$1 AND host=$2 LIMIT 1', [campaignId, host]
    );
    if (casa.length) return dest;
    console.warn(`clique recusado: destino ${host} não pertence à campanha ${campaignId}`);
    return '/';
  } catch (e) {
    // 42P01: migração 064 por correr. Não se trava um clique legítimo por
    // causa disso — volta-se ao comportamento anterior.
    if (e.code !== '42P01') console.error('validação do destino falhou:', e?.message);
    return dest;
  }
}

// Agentes que vão buscar as imagens e seguem os links SEM ninguém ter aberto
// o email: filtros de segurança que analisam tudo o que entra, e a
// pré-visualização do Apple Mail Privacy Protection, que descarrega na
// entrega.
//
// O Gmail e o Yahoo NÃO estão aqui, e é deliberado: ao contrário dos outros,
// só vão buscar a imagem quando a pessoa abre a mensagem. Servem-na do seu
// proxy para proteger o IP de quem lê, mas o pedido é uma abertura verdadeira,
// e é assim que toda a indústria a conta. Estiveram nesta lista e apagavam as
// aberturas do maior cliente de email que existe.
//
// "mail-proxy" também saiu: era genérico e apanhava o Yahoo pelo endereço da
// própria página de ajuda que ele põe no agente.
const AGENTE_AUTOMATICO = /preview\.mail\.icloud|mimecast|proofpoint|barracuda|cloudmark|symantec.*email|messagelabs|sophos|ironport|postfix|spamassassin|url.*scanner|link.*scanner|phishtank|avira|kaspersky.*mail/i;

// Nada é descartado: um evento automático é gravado com o seu próprio tipo.
//
// As consultas de métricas — são dezesseis — filtram todas por type='open' ou
// type='click', por isso passam a excluir os automáticos sem serem tocadas.
// Uma coluna booleana obrigaria a alterar as dezesseis e a nunca esquecer
// nenhuma. E filtrar deixa de ser uma decisão irreversível tomada aqui: se um
// filtro estiver errado, os números são recalculáveis em vez de perdidos.
//
// Enquanto a migração 054 não correr, os tipos novos não existem no enum e o
// INSERT devolve 22P02. Nesse caso volta-se ao comportamento anterior — o
// evento humano é gravado, o automático é descartado — para a contagem nunca
// parar por causa de uma migração em falta.
let tiposAutoDisponiveis = true;
async function registarEvento({ campaignId, contactId, tipo, url = null, ua = '' }) {
  const automatico = AGENTE_AUTOMATICO.test(ua);
  const agente = String(ua || '').slice(0, 200) || null;
  if (automatico && !tiposAutoDisponiveis) return { automatico, gravado: false };
  const nome = automatico ? `${tipo}_auto` : tipo;
  try {
    await query(
      `INSERT INTO email_events (campaign_id, contact_id, type, url, user_agent, created_at)
       VALUES ($1,$2,$3::event_type,$4,$5,NOW())`,
      [campaignId, contactId, nome, url, agente]
    );
    return { automatico, gravado: true };
  } catch (e) {
    // 22P02 = o valor não existe no enum; 42703 = a coluna user_agent não
    // existe. Nos dois casos a migração ainda não correu.
    if (e.code !== '22P02' && e.code !== '42703') throw e;
    if (e.code === '22P02') tiposAutoDisponiveis = false;
    if (automatico) return { automatico, gravado: false };
    await query(
      `INSERT INTO email_events (campaign_id, contact_id, type, url, created_at)
       VALUES ($1,$2,$3::event_type,$4,NOW())`,
      [campaignId, contactId, tipo, url]
    );
    return { automatico, gravado: true };
  }
}

function rawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method === 'POST') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-amz-sns-message-type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    // Segredo opcional no URL (?k=). Deixou de ser a barreira — é apenas uma
    // camada extra para quem o queira usar. A barreira é a assinatura, logo a
    // seguir. Quando definido, um ?k= errado é recusado já aqui.
    const _whSecret = process.env.SNS_WEBHOOK_SECRET;
    if (_whSecret) {
      // Buffers primeiro, e comparar por comprimento de BYTES: timingSafeEqual
      // rebenta com buffers de tamanhos diferentes, e String.length conta
      // unidades UTF-16, não bytes.
      const fornecido = Buffer.from(String((req.query && req.query.k) || ''));
      const esperado = Buffer.from(String(_whSecret));
      const autorizado = fornecido.length === esperado.length
        && crypto.timingSafeEqual(fornecido, esperado);
      if (!autorizado) return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { return res.status(400).end(); }
      }
      if (!body) {
        const raw = await rawBody(req);
        try { body = JSON.parse(raw); } catch { return res.status(400).end(); }
      }

      // ── A barreira ────────────────────────────────────────────────────────
      // Toda a mensagem tem de vir num envelope SNS assinado pela Amazon, e o
      // tópico tem de ser um dos nossos. Isto substitui o gate anterior, que
      // só exigia um segredo no URL quando a variável de ambiente existisse —
      // e que, não existindo, deixava qualquer pessoa suprimir contactos.
      //
      // Falha FECHADO: sem assinatura válida não se processa nada.
      const veredicto = await verificarMensagemSns(body, {
        arnsPermitidos: process.env.SNS_TOPIC_ARNS || '',
      });
      if (!veredicto.valido) {
        console.warn('webhook SNS recusado:', veredicto.motivo);
        return res.status(403).json({ error: 'Forbidden' });
      }
      if (!veredicto.arnsConfigurados) {
        // Sem lista de tópicos, a assinatura prova que veio do SNS mas não de
        // que conta. Registar o ARN real permite fixá-lo numa variável e
        // fechar também essa porta.
        console.warn('webhook SNS aceite sem lista de tópicos — define SNS_TOPIC_ARNS=' + veredicto.topicArn);
      }

      // Idempotência. O SNS entrega PELO MENOS uma vez, e nada aqui detectava
      // uma reentrega: o ramo de bounce transitório incrementa retry_count, por
      // isso uma reentrega consumia tentativas de um destinatário que ainda as
      // tinha e, à terceira, punha a linha em 'failed' — um envio perdido, não
      // só um número errado. E os INSERTs de eventos duplicavam, porque
      // email_events não tem restrição de unicidade nenhuma.
      if (body.Type === 'Notification' && body.MessageId) {
        try {
          const novo = await query(
            `INSERT INTO webhook_events (sns_message_id, tipo) VALUES ($1, $2)
             ON CONFLICT (sns_message_id) DO NOTHING RETURNING sns_message_id`,
            [String(body.MessageId), 'Notification']
          );
          if (!novo.length) {
            console.warn('webhook SNS repetido, ignorado:', body.MessageId);
            return res.status(200).json({ ok: true, duplicado: true });
          }
        } catch (e) {
          // 42P01: migração 063 por correr. Continua-se — perder a
          // idempotência é mau, perder os eventos todos é pior.
          if (e.code !== '42P01') throw e;
          console.warn('webhook_events não existe — corre migrations/063_eventos_do_webhook.sql');
        }
      }

      if (body.Type === 'SubscriptionConfirmation') {
        // Só se confirma uma subscrição de um tópico explicitamente
        // autorizado. Confirmar às cegas deixava qualquer pessoa inscrever
        // este endpoint num tópico da conta AWS dela e, a partir daí, enviar
        // eventos que passam na verificação da assinatura.
        if (!veredicto.arnsConfigurados) {
          console.warn('Subscrição SNS NÃO confirmada: define SNS_TOPIC_ARNS=' + veredicto.topicArn + ' e repete a subscrição.');
          return res.status(202).json({ ok: true, confirmed: false, reason: 'topic_not_allowlisted' });
        }
        try {
          const parsed = new URL(body.SubscribeURL || '');
          if (parsed.protocol === 'https:' && HOST_CERT.test(parsed.hostname)) {
            await fetch(parsed.href);
          }
        } catch {}
        return res.status(200).json({ ok: true, confirmed: true });
      }

      let sesEvent = body;
      if (body.Type === 'Notification' && body.Message) {
        try { sesEvent = JSON.parse(body.Message); } catch { return res.status(400).end(); }
      }

      const eventType = (sesEvent.eventType || sesEvent.notificationType || '').toLowerCase();

      // Âmbito. Os UPDATE de bounce e de queixa filtravam só por email, sem
      // qualquer referência a campanha ou mensagem — e o evento do SES traz o
      // mail.messageId, que já é gravado em campaign_recipients.message_id no
      // envio. A informação para delimitar existia e não era usada.
      //
      // Consequência: um bounce de HOJE reclassificava as linhas desse
      // endereço em TODAS as campanhas em que alguma vez esteve, incluindo
      // campanhas de outras marcas fechadas há meses. O ramo transitório era
      // pior do que um número errado: consumia o retry_count de campanhas a
      // decorrer e, à terceira, punha a linha em 'failed'.
      //
      // Quando o messageId não casa com nada (envios anteriores à gravação da
      // coluna) recorre-se ao email, mas limitado a uma janela curta em vez de
      // todo o histórico.
      const msgId = sesEvent.mail?.messageId || null;
      // `n` é o índice do próximo parâmetro em cada consulta.
      const limite = (n) => msgId ? `AND message_id = $${n}` : `AND sent_at > NOW() - INTERVAL '7 days'`;
      const limiteP = msgId ? [msgId] : [];

      if (eventType === 'bounce') {
        const bounce = sesEvent.bounce || {};
        const recipients = bounce.bouncedRecipients || [];
        const isPermanent = bounce.bounceType === 'Permanent';
        const isTransient = bounce.bounceType === 'Transient';

        await transaction(async (q) => {
          const eventRows = [];

          for (const r of recipients) {
            const email = r.emailAddress?.toLowerCase();
            if (!email) continue;

            if (isTransient) {
              // Only re-queue rows not yet delivered (status='retry'). Rows already
              // recorded as 'sent' were accepted by SES; re-queuing them would send
              // a duplicate. For those, just log the bounce without changing status.
              const retryRows = await q(
                `UPDATE campaign_recipients
                 SET retry_count = COALESCE(retry_count, 0) + 1,
                     error_message = $2,
                     status = CASE WHEN COALESCE(retry_count, 0) >= 2 THEN 'failed' ELSE 'retry' END
                 WHERE email=$1 AND status = 'retry' ${limite(3)}
                 RETURNING campaign_id, contact_id`,
                [email, r.diagnosticCode || 'Soft bounce', ...limiteP]
              );
              const sentRows = await q(
                `UPDATE campaign_recipients SET error_message=$2
                 WHERE email=$1 AND status = 'sent' ${limite(3)}
                 RETURNING campaign_id, contact_id`,
                [email, r.diagnosticCode || 'Soft bounce', ...limiteP]
              );
              eventRows.push(...retryRows, ...sentRows);
            } else {
              const rows = await q(
                `UPDATE campaign_recipients SET status='bounced', error_message=$2
                 WHERE email=$1 AND status IN ('sent','retry') ${limite(3)}
                 RETURNING campaign_id, contact_id`,
                [email, r.diagnosticCode || (isPermanent ? 'Hard bounce' : 'Bounce'), ...limiteP]
              );
              eventRows.push(...rows);
            }
          }

          if (eventRows.length) {
            const vals = eventRows.map((_, i) => `($${i*2+1},$${i*2+2},'bounce',NOW())`).join(',');
            await q(
              `INSERT INTO email_events (campaign_id, contact_id, type, created_at) VALUES ${vals}`,
              eventRows.flatMap(r => [r.campaign_id, r.contact_id])
            );
          }

          if (isPermanent) {
            const emails = recipients.map(r => r.emailAddress?.toLowerCase()).filter(Boolean);
            if (emails.length) {
              await q(
                `INSERT INTO suppression (email, reason) SELECT unnest($1::text[]), 'bounce' ON CONFLICT (email) DO NOTHING`,
                [emails]
              );
              await q(`UPDATE contacts SET status='bounced' WHERE email = ANY($1::text[])`, [emails]);
            }
          }
        });

      } else if (eventType === 'complaint') {
        const complaint = sesEvent.complaint || {};
        const recipients = complaint.complainedRecipients || [];

        await transaction(async (q) => {
          const eventRows = [];
          for (const r of recipients) {
            const email = r.emailAddress?.toLowerCase();
            if (!email) continue;
            // Uma queixa punha em 'failed' — estado terminal — as linhas
            // 'sent' desse endereço em TODAS as campanhas passadas. Uma queixa
            // de hoje apagava o registo de entrega de campanhas de há meses,
            // atravessando a fronteira de marca.
            const rows = await q(
              `UPDATE campaign_recipients SET status='failed'
               WHERE email=$1 AND status='sent' ${limite(2)}
               RETURNING campaign_id, contact_id`,
              [email, ...limiteP]
            );
            eventRows.push(...rows);
          }

          if (eventRows.length) {
            const vals = eventRows.map((_, i) => `($${i*2+1},$${i*2+2},'spam',NOW())`).join(',');
            await q(
              `INSERT INTO email_events (campaign_id, contact_id, type, created_at) VALUES ${vals} ON CONFLICT DO NOTHING`,
              eventRows.flatMap(r => [r.campaign_id, r.contact_id])
            );
          }

          const emails = recipients.map(r => r.emailAddress?.toLowerCase()).filter(Boolean);
          if (emails.length) {
            await q(
              `INSERT INTO suppression (email, reason) SELECT unnest($1::text[]), 'spam' ON CONFLICT (email) DO NOTHING`,
              [emails]
            );
            await q(`UPDATE contacts SET status='complained' WHERE email = ANY($1::text[])`, [emails]);
          }
        });

      } else if (eventType === 'open') {
        const mail = sesEvent.mail || {};
        const campaignId = mail.headers?.find(h => h.name === 'X-Campaign-Id')?.value;
        const contactId  = mail.headers?.find(h => h.name === 'X-Contact-Id')?.value;
        if (campaignId && contactId) {
          await query(
            `INSERT INTO email_events (campaign_id, contact_id, type, created_at) VALUES ($1,$2,'open',NOW())`,
            [campaignId, contactId]
          );
        }

      } else if (eventType === 'click') {
        const mail = sesEvent.mail || {};
        const click = sesEvent.click || {};
        const campaignId = mail.headers?.find(h => h.name === 'X-Campaign-Id')?.value;
        const contactId  = mail.headers?.find(h => h.name === 'X-Contact-Id')?.value;
        if (campaignId && contactId) {
          await query(
            `INSERT INTO email_events (campaign_id, contact_id, type, url, created_at) VALUES ($1,$2,'click',$3,NOW())`,
            [campaignId, contactId, click.link || null]
          );
        }
      }

      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('Webhook error:', err?.message);
      return res.status(500).json({ error: 'Erro interno' });
    }
  }

  const { type, cid, uid, t, url, action, id, token } = req.query;

  // ── Public campaign preview (/api/preview rewrites here) ─────────
  if (action === 'preview') {
    function errPage(msg) {
      return `<!DOCTYPE html><html lang="pt"><head><meta charset="UTF-8"><title>Erro — PrimeMail</title>
<style>body{font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;background:#f1f5f9;color:#334155;gap:8px}
p{font-size:15px}small{color:#94a3b8;font-size:12px}</style></head>
<body><p>${msg}</p><small>PrimeMail</small></body></html>`;
    }
    function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

    if (!id || !token) return res.status(400).send(errPage('Link inválido.'));
    if (!process.env.JWT_SECRET) return res.status(500).send(errPage('Configuração em falta.'));

    // Aceita o token curto (/v/:id/:token) e o de 64 caracteres dos emails
    // já enviados.
    if (!previewTokenValido(id, token)) return res.status(403).send(errPage('Link inválido ou sem permissão.'));

    try {
      const rows = await query(
        `SELECT c.name, c.subject, b.name AS brand_name, b.logo_url AS brand_logo,
                b.variables AS brand_variables, t.html_content
         FROM campaigns c
         LEFT JOIN templates t ON t.id = c.template_id
         LEFT JOIN brands b ON b.id = c.brand_id
         WHERE c.id = $1`, [id]
      );
      if (!rows[0]) return res.status(404).send(errPage('Campanha não encontrada.'));
      const c = rows[0];
      if (!c.html_content) return res.status(404).send(errPage('Esta campanha não tem um template de email associado.'));

      // O rodapé legal é acrescentado em tempo de envio, não está gravado no
      // template — por isso tem de ser montado aqui também, senão a
      // pré-visualização mostrava o email sem ele.
      let footerCfg = {};
      try {
        const gs = await query('SELECT disclaimer, footer_logo_url, footer_socials, email_width FROM global_settings WHERE id=1');
        footerCfg = gs[0] || {};
      } catch (_) {}
      // Largura desta campanha: a que está declarada no seu HTML, com a
      // definição global como recurso. Serve o rodapé (para não sair mais
      // largo do que o corpo) e a moldura do iframe (para não cortar um email
      // mais largo do que ela).
      const larguraEmail = Math.min(900, Math.max(320,
        detectContentWidth(c.html_content) || parseInt(footerCfg.email_width, 10) || 640));
      const rodape = buildLegalFooter({
        globalDisclaimer: footerCfg.disclaimer,
        footerLogoUrl: footerCfg.footer_logo_url,
        footerSocials: footerCfg.footer_socials || {},
        width: larguraEmail,
        brandName: c.brand_name,
        variables: c.brand_variables || {},
        // Numa pré-visualização não há destinatário nem link próprio de
        // cancelamento: mostra-se a estrutura, sem endereço inventado.
        email: '',
        unsubUrl: `${APP_URL_PREVIEW}#unsubscribe`,
        previewUrl: '',
        semRodapeLegal: await lerRodapeLegal(id),
      });

      // Numa pré-visualização todos os links devem abrir noutro separador: é o
      // que permite clicá-los sem perder a página de pré-visualização, e é a
      // única navegação que o sandbox do iframe autoriza (allow-popups). Sem
      // isto, um link com target="_self" ficava simplesmente inerte.
      const semComentario = updateSocialIcons(stripEditorMetadata(c.html_content))
        .replace(/<\/body>/i, `${rodape}</body>`);
      // Junto com o <base>, entra a recusa do modo escuro automático: as
      // campanhas gravadas antes de isso passar a sair no MJML não a têm no
      // seu próprio <head>, e a pré-visualização apareceria escurecida pelo
      // browser mesmo com a página de fora já corrigida (o iframe é um
      // documento à parte e é avaliado por si).
      const cabeca = '<base target="_blank"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><style>:root{color-scheme:only light}</style>';
      const emailHtml = /<head[^>]*>/i.test(semComentario)
        ? semComentario.replace(/<head([^>]*)>/i, `<head$1>${cabeca}`)
        : `${cabeca}${semComentario}`;
      // Quem não preenche o nome da campanha fica com ele igual ao assunto,
      // e a barra mostrava a mesma frase duas vezes. O nome só encabeça a
      // barra quando diz algo diferente do assunto; caso contrário fica só o
      // assunto, sem segunda linha.
      const nomeCampanha = (c.name || '').trim();
      const assuntoCampanha = (c.subject || '').trim();
      const nomeProprio = (nomeCampanha && nomeCampanha !== assuntoCampanha) ? nomeCampanha : '';
      const tituloPreview = nomeProprio || assuntoCampanha || 'Campanha';
      const subtituloPreview = nomeProprio ? assuntoCampanha : '';

      const brandRight = c.brand_logo
        ? `<img src="${esc(c.brand_logo)}" alt="${esc(c.brand_name||'')}" class="bar-logo">`
        : `<span class="bar-brand">${esc(c.brand_name||'')}</span>`;
      const html = `<!DOCTYPE html>
<html lang="pt"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(c.subject || c.name)} — Pré-visualização</title>
<meta name="robots" content="noindex,nofollow">
<meta name="color-scheme" content="light">
<!-- "only light" desliga o modo escuro automático do Chrome. Sem isto o
     browser escurecia a pré-visualização por sua conta: a área clara do
     rodapé aparecia cinzenta escura e os ícones das redes ficavam dentro de
     um quadrado branco ao passar o rato (fundo por omissão do link). -->
<style>:root{color-scheme:only light}*{margin:0;padding:0;box-sizing:border-box}body{background:#f1f5f9;min-height:100vh;font-family:system-ui,sans-serif}
.bar{background:#0f172a;color:#fff;padding:10px 20px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100}
.bar-left{display:flex;align-items:center;gap:10px}.bar-tag{background:#1e293b;color:#94a3b8;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
.bar-name{color:#f8fafc;font-weight:600;font-size:13px}.bar-sub{color:#94a3b8;font-size:12px;margin-top:1px}.bar-brand{color:#64748b;font-size:12px}
.bar-logo{height:32px;width:auto;object-fit:contain;display:block;filter:brightness(0) invert(1);opacity:.85}
.wrap{padding:24px 16px;display:flex;justify-content:center}iframe{border:none;background:#fff;box-shadow:0 4px 32px rgba(0,0,0,.12);border-radius:8px;width:100%;max-width:${Math.max(680, larguraEmail + 40)}px;min-height:500px;display:block}</style>
</head><body>
<div class="bar"><div class="bar-left"><span class="bar-tag">Pré-visualização</span><div><div class="bar-name">${esc(tituloPreview)}</div>${subtituloPreview?`<div class="bar-sub">${esc(subtituloPreview)}</div>`:''}</div></div>${brandRight}</div>
<div class="wrap"><iframe id="f" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" title="Pré-visualização do email"></iframe></div>
<script>(function(){const h=${JSON.stringify(emailHtml).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')};const f=document.getElementById('f');f.srcdoc=h;f.addEventListener('load',function(){try{const s=f.contentDocument.documentElement.scrollHeight;if(s>100)f.style.height=s+'px';}catch(_){}});})();</script>
</body></html>`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('X-Robots-Tag', 'noindex');
      return res.status(200).send(html);
    } catch (err) {
      console.error('preview:', err);
      return res.status(500).send(errPage('Erro de servidor.'));
    }
  }

  if (type === 'click') {
    // Validate HMAC token before trusting the url param — prevents open-redirect abuse.
    let dest = '/';
    try {
      if (cid && uid && t) {
        const expected = trackToken(cid, uid);
        const campaignId = parseInt(cid, 10);
        const contactId  = parseInt(uid, 10);
        const valid = t.length === expected.length
          && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(expected));
        if (valid && !isNaN(campaignId) && !isNaN(contactId)) {
          dest = destinoSeguro(url) || '/';
          // O token autentica o PAR (campanha, contacto), não o DESTINO — o
          // comentário acima dizia que prevenia open redirect, mas o `url`
          // não entra no HMAC. Quem tenha recebido um email tem um par válido
          // e permanente e podia mandar o domínio da plataforma redireccionar
          // para qualquer sítio, incluindo uma página de phishing com a marca
          // da Caetano no endereço.
          //
          // Valida-se contra os destinos que a própria campanha contém
          // (migração 064, registados no arranque do envio). Campanhas sem
          // registo — todas as anteriores a isto — não são validadas, para os
          // links já entregues continuarem a funcionar.
          if (dest !== '/') {
            dest = await destinoDaCampanha(campaignId, dest);
          }
          // uid=0 é o clique de um email de teste: encaminha-se para o
          // destino, mas não se registra — não há contacto 0 e não deve
          // contar nas estatísticas da campanha.
          if (contactId !== 0) {
            // O reencaminhamento acontece sempre — mesmo um clique automático
            // tem de levar a pessoa (ou o analisador) ao destino. O que muda é
            // o tipo com que fica registado.
            //
            // Os cliques nunca tinham filtro de agente, ao contrário das
            // aberturas. Uma campanha deste mês mostrava 2,46% quando o número
            // real era 0,48%: de 31 que clicaram, 25 fizeram-no no primeiro
            // minuto após a entrega, e um deles clicou 25 vezes. Não era gente.
            // Grava-se o destino JÁ VALIDADO, nunca o parâmetro em bruto. O
            // que aqui entrasse voltava ao painel no relatório da campanha, e
            // qualquer pessoa que tenha recebido a campanha pode escrever
            // neste parâmetro — era XSS armazenado com um GET anónimo.
            await registarEvento({
              campaignId, contactId, tipo: 'click', url: dest !== '/' ? dest : null,
              ua: req.headers['user-agent'] || '',
            });
          }
        }
      }
    } catch (e) {
      console.error('track click error:', e.message);
    }
    res.setHeader('Location', dest);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(302).end();
  }

  // Pixel de abertura — registado antes de devolver a imagem.
  //
  // Nada é descartado: ver registarEvento e AGENTE_AUTOMATICO no topo. Um
  // agente automático fica gravado como 'open_auto', que as contagens não
  // incluem — mas passa a existir, e a decisão de o excluir passa a ser
  // reversível.
  //
  // O pixel vai no INÍCIO do corpo do email (ver injectOpenPixel em
  // lib/emailHtml.js): estava no fim, e num email cortado pelo Gmail nunca
  // era carregado.
  try {
    if (cid && uid && t) {
      const expected = trackToken(cid, uid);
      const campaignId = parseInt(cid, 10);
      const contactId  = parseInt(uid, 10);
      if (t === expected && !isNaN(campaignId) && !isNaN(contactId)) {
        await registarEvento({
          campaignId, contactId, tipo: 'open',
          ua: req.headers['user-agent'] || '',
        });
      }
    }
  } catch (e) {
    console.error('track open error:', e.message);
  }
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  return res.status(200).end(PIXEL);
};
