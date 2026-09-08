#!/usr/bin/env node
// Verifica que cada função serverless carrega e corre no runtime de produção.
//
// Corre cada ficheiro num processo próprio com --no-experimental-require-module,
// que desliga o require() de módulos ESM. É a diferença que deixou passar uma
// regressão: o Node 22 local suporta require(esm) e carregava sem erro, mas o
// runtime da Vercel não, e as funções respondiam 500 com ERR_REQUIRE_ESM.
//
//   node scripts/check-runtime.js
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DIRS = ['api', 'api/campaigns', 'api/brands', 'api/templates', 'api/contacts', 'api/lists', 'api/sync', 'lib'];
const alvos = [];
for (const dir of DIRS) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.js')) alvos.push(path.join(dir, f));
}

const env = { ...process.env, DATABASE_URL: process.env.DATABASE_URL || 'postgres://u:p@localhost:5432/x', JWT_SECRET: process.env.JWT_SECRET || 'x', APP_URL: 'https://exemplo.pt' };
const correr = (codigo) => execFileSync(process.execPath, ['--no-experimental-require-module', '-e', codigo], { env, stdio: ['ignore', 'pipe', 'pipe'] }).toString();

let falhas = 0;
console.log('Carregamento das funções (sem require(esm), como em produção):');
for (const alvo of alvos) {
  try { correr(`require('./${alvo}')`); console.log('  ok    ', alvo); }
  catch (e) {
    const err = String(e.stderr || '');
    const esm = /ERR_REQUIRE_ESM/.test(err);
    if (esm) { falhas++; console.error('  ESM!  ', alvo, '-> ERR_REQUIRE_ESM'); }
    else console.error('  erro  ', alvo, '->', (err.split('\n').find(l => /Error/.test(l)) || '').trim());
    if (!esm) falhas++;
  }
}

console.log('\nExecução das dependências críticas:');
const provas = [
  ['compilação MJML', `require('mjml')('<mjml><mj-body><mj-section><mj-column><mj-text>x</mj-text></mj-column></mj-section></mj-body></mjml>',{validationLevel:'soft'}).then(r=>{if(!r.html)throw new Error('sem html')})`],
  ['sanitize-html', `const s=require('./lib/emailFooter').sanitizeDisclaimer('<b>a</b><script>x</script>');if(s!=='<b>a</b>')throw new Error('resultado inesperado: '+s)`],
  ['rodapé legal', `const f=require('./lib/emailFooter').buildLegalFooter({globalDisclaimer:'x',email:'a@b.pt'});if(!/f1f1f1/.test(f))throw new Error('rodapé sem area cinzenta')`],
  ['a importação na campanha não fica em memória', `const fs=require('fs');
    const h=fs.readFileSync('email.html','utf8');
    // A campanha é criada antes do loop e o id guardado numa variável local:
    // sair da campanha a meio da importação punha os contactos na campanha
    // errada (ou numa nova) quando a associação era feita só no fim.
    if(!h.includes('const campanhaId = await _wizGarantirCampanha();'))
      throw new Error('a importação deixou de fixar a campanha antes de começar');
    if(!h.includes('const tratarBloco = async'))
      throw new Error('a importação deixou de ir em blocos — um pedido por contacto torna impossível importar milhares');
    if(!h.includes("action=bulk_import"))
      throw new Error('a importação da campanha deixou de usar o bulk_import (um INSERT por bloco)');
    if(!h.includes('emails, all_temp: true'))
      throw new Error('a associação deixou de ser por email: voltaria a ser preciso um pedido por contacto para saber o id');
    if(!h.includes('const nestaCampanha = () =>'))
      throw new Error('sem a verificação nestaCampanha, a importação mexe nos contadores da campanha errada');
    // Associar os contactos importados só quando a campanha já existia
    // deixava-os apenas em memória: sair do wizard — trocar de marca, por
    // exemplo — perdia a importação toda.
    if(h.includes('if (_editingCampaignId && newIds.length)'))
      throw new Error('a importação volta a só associar quando a campanha já existe — perde-se ao sair do wizard');
    if(!h.includes('async function _wizGarantirCampanha'))
      throw new Error('falta _wizGarantirCampanha, que cria a campanha para a importação poder ser gravada');
    if(h.includes('Serão adicionados à campanha ao guardar'))
      throw new Error('voltou a mensagem que prometia associar mais tarde — agora é associado logo');`],
  ['contactos de ficheiro fora da listagem', `const fs=require('fs');
    const a=fs.readFileSync('api/contacts/index.js','utf8');
    if(!a.includes('NOT COALESCE(c.hidden, FALSE)'))throw new Error('a listagem de contactos deixou de excluir os não listados');
    if(!a.includes('ocultarNovos'))throw new Error('o POST deixou de marcar os contactos vindos de um ficheiro de campanha');
    if(!fs.readFileSync('email.html','utf8').includes('one_off: true'))throw new Error('o upload no envio deixou de marcar os contactos como não listados');
    const c=fs.readFileSync('lib/contactos.js','utf8');
    if(!c.includes('r.criado && r.id'))throw new Error('só os contactos criados agora podem ser marcados: um ficheiro não pode esconder quem já existia');
    if(!fs.readFileSync('api/lists/index.js','utf8').includes('marcarOculto'))throw new Error('entrar numa lista tem de desmarcar o contacto');`],
  ['o envio não apaga contactos', `const fs=require('fs');
    // campaign_recipients.contact_id é ON DELETE CASCADE: apagar um contacto
    // no fim do envio apaga também a linha do destinatário, e a campanha fica
    // sem relatório logo depois de ter sido enviada. Já aconteceu, e os dois
    // motores de envio chegaram a fazer coisas diferentes.
    for(const f of ['lib/sendCampaign.js','api/campaigns/[id].js']){
      const linhas=fs.readFileSync(f,'utf8').split(String.fromCharCode(10))
        .filter(l=>{const t=l.trim();return !t.startsWith('//') && !t.startsWith('*');});
      if(linhas.join(' ').includes('DELETE FROM contacts'))
        throw new Error(f+' volta a apagar contactos durante o envio — isso apaga o relatório da campanha (CASCADE)');
    }`],
  ['um ficheiro não cancela subscrições', `const fs=require('fs');
    // "não", "n" e "0" numa coluna "estado" valiam cancelamento. Uma coluna
    // dessas num ficheiro interno significa quase sempre outra coisa, e o
    // estrago não se vê: o contacto deixa de receber para sempre, sem sequer
    // aparecer na lista de supressão. Aconteceu a 1355 contactos.
    for(const f of ['email.html','api/contacts/index.js']){
      const s=fs.readFileSync(f,'utf8');
      const mapa=(s.match(/(_IMP_STATUS|STATUS_ALIASES) = \\{[\\s\\S]*?\\};/)||[''])[0];
      if(!mapa)throw new Error('não encontrei a tabela de estados em '+f);
      for(const v of ["nao:","'não':","n:","'0':","sim:","s:","'1':"])
        if(mapa.includes(v))throw new Error(f+' voltou a aceitar um valor ambíguo ('+v+') como estado');
      if(!mapa.includes('cancelado'))throw new Error(f+' deixou de reconhecer as palavras explícitas');
    }
    const h=fs.readFileSync('email.html','utf8');
    if(!h.includes('if (r.status) { comEstadoNoFicheiro++; delete r.status; }'))
      throw new Error('a importação de campanha voltou a deixar o ficheiro mexer no estado dos contactos');`],
  ['a MJML não come redes sociais', `const fs=require('fs');
    // Com name e sem src, é a MJML que resolve o endereço do ícone por uma
    // lista interna. Essa lista não tem TikTok — e a MJML não dá erro:
    // descarta o elemento em silêncio. Cinco redes no editor saíam quatro no
    // email, e no editor apareciam as cinco porque o editor tem o seu próprio
    // renderizador. Levou três voltas a encontrar.
    const h=fs.readFileSync('email.html','utf8');
    const els=h.match(/<mj-social-element[^\`]*?\\/>/g)||h.match(/<mj-social-element[\\s\\S]{0,400}?<\\/mj-social-element>/g)||[];
    if(!els.length)throw new Error('não encontrei a geração dos mj-social-element');
    for(const e of els){
      if(!/src="/.test(e))
        throw new Error('um mj-social-element sem src: a MJML volta a decidir o ícone e a comer as redes que não conhece');
      if(!/background-color="transparent"/.test(e))
        throw new Error('sem background-color="transparent" a MJML pinta a cor que tem guardada para a rede, e são antigas');
    }
    // Prova com o compilador a sério: cinco entram, cinco saem.
    const mjml=require(process.cwd()+'/node_modules/mjml');
    const el=(n)=>'<mj-social-element name="'+n+'" href="https://x.pt" src="https://emkt.caetano.pt/social/'+n+'.png" background-color="transparent" />';
    const redes=['facebook','instagram','linkedin','youtube','tiktok'];
    const doc='<mjml><mj-body><mj-section><mj-column><mj-social icon-size="40px" mode="horizontal">'
      +redes.map(el).join('')+'</mj-social></mj-column></mj-section></mj-body></mjml>';
    mjml(doc,{validationLevel:'soft',fonts:{}}).then(r=>{
      const imgs=(r.html.match(/src="[^"]*social\\/[^"]*"/g)||[]);
      if(imgs.length!==redes.length)
        throw new Error('a MJML devolveu '+imgs.length+' ícones de '+redes.length+' — está a descartar elementos outra vez');
      if(!/tiktok\\.png/.test(r.html))throw new Error('o tiktok não sobreviveu à compilação');
      if(/background:#3b5998/.test(r.html))throw new Error('a MJML voltou a pintar a cor antiga por trás do ícone');
    }).catch(e=>{throw e});`],
  ['ícones das redes sociais existem', `const fs=require('fs');
    // Um src que dá 404 dentro de um email é um quadrado partido em todos os
    // destinatários, e não há como o corrigir depois de enviado. O conjunto da
    // MJML não tem TikTok — e o rodapé já oferecia TikTok na lista de redes.
    const REDES=['facebook','instagram','x','youtube','linkedin','tiktok','whatsapp','telegram','snapchat'];
    for(const n of REDES){
      const f='social/'+n+'.png';
      if(!fs.existsSync(f))throw new Error('falta o ícone '+f+' — o src fica a dar 404 dentro do email');
      const b=fs.readFileSync(f);
      if(b.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')
        throw new Error(f+' não é um PNG válido');
      if(b.readUInt32BE(16)!==200||b.readUInt32BE(20)!==200)
        throw new Error(f+' devia ser 200x200 e é '+b.readUInt32BE(16)+'x'+b.readUInt32BE(20));
    }
    // Ficheiros estáticos de propósito: o projecto está no limite de 12 funções
    // serverless do plano, e a 13.ª fez o deploy falhar.
    if(fs.existsSync('api/social-icon.js'))
      throw new Error('os ícones voltaram a ser uma função serverless — isso esgota o limite do plano e parte o build');
    const fns=[];
    (function anda(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){
      const p=d+'/'+e.name;
      if(e.isDirectory())anda(p); else if(e.name.endsWith('.js'))fns.push(p);
    }})('api');
    if(fns.length>12)
      throw new Error('api/ tem '+fns.length+' funções e o plano permite 12: o deploy vai falhar. Junta a rota nova a uma existente por ?action=');
    // As duas pontas que montam o email têm de apontar para cá.
    const html=fs.readFileSync('email.html','utf8');
    const footer=fs.readFileSync('lib/emailFooter.js','utf8');
    for(const [f,s] of [['email.html',html],['lib/emailFooter.js',footer]]){
      if(!/\\/social\\/\\$\\{(rede|network)\\}\\.png/.test(s))
        throw new Error(f+' voltou a ir buscar os ícones à Mailjet — o TikTok não existe lá');
      if(!/'tiktok'/.test(s))throw new Error(f+' deixou de reconhecer o tiktok');
    }
    if(!/const TE_SOCIAL_NETWORKS = \\[[^\\]]*'tiktok'/.test(html))
      throw new Error('tiktok saiu da lista de redes do editor');
    // Sem isto, a CDN serve os ícones com a cache curta por omissão.
    const vj=JSON.parse(fs.readFileSync('vercel.json','utf8'));
    if(!(vj.headers||[]).some(h=>/social/.test(h.source||'')&&(h.headers||[]).some(x=>/immutable/.test(x.value||''))))
      throw new Error('falta a regra de cache para /social/ no vercel.json');
    // O endereço do ícone está gravado dentro do HTML de cada campanha, por
    // isso trocar o conjunto não corrige nada do que já existe: sem esta
    // reescrita, as campanhas antigas continuam a mandar os ícones velhos, e
    // as que tenham TikTok mandam um 404.
    const {updateSocialIcons}=require(process.cwd()+'/lib/emailHtml');
    const antigo='https://www.mailjet.com/images/theme/v1/icons/ico-social/tiktok.png';
    const refeito=updateSocialIcons('<img src="'+antigo+'">','https://emkt.caetano.pt');
    if(!refeito.includes('/social/tiktok.png')||refeito.includes('mailjet'))
      throw new Error('a reescrita dos ícones gravados deixou de funcionar');
    if(updateSocialIcons(refeito)!==refeito)
      throw new Error('a reescrita tem de ser idempotente — corre em cada envio');
    const naoNossa='https://www.mailjet.com/images/theme/v1/icons/ico-social/pinterest.png';
    if(!updateSocialIcons('<img src="'+naoNossa+'">').includes(naoNossa))
      throw new Error('uma rede sem ícone nosso não pode ser reescrita para um 404');
    for(const f of ['api/track.js','lib/sendCampaign.js','api/campaigns/[id].js'])
      if(!/updateSocialIcons\\(stripEditorMetadata/.test(fs.readFileSync(f,'utf8')))
        throw new Error(f+' monta o email sem reescrever os ícones gravados');
    // As três listas de nomes têm de ser a mesma: uma rede que esteja numa e
    // não noutra fica com o ícone velho num sítio e o novo noutro.
    const listas={
      'email.html (TE_SOCIAL_PROPRIOS)': /TE_SOCIAL_PROPRIOS = \\[([^\\]]*)\\]/.exec(html),
      'lib/emailFooter.js (SOCIAL_ICON_PROPRIOS)': /SOCIAL_ICON_PROPRIOS = \\[([\\s\\S]*?)\\]/.exec(footer),
      'lib/emailHtml.js (SOCIAL_PROPRIAS)': /SOCIAL_PROPRIAS = \\[([\\s\\S]*?)\\]/.exec(fs.readFileSync('lib/emailHtml.js','utf8')),
    };
    const chaves=(m)=>((m&&m[1])||'').match(/'[a-z]+'/g)||[];
    const ref=chaves(listas['email.html (TE_SOCIAL_PROPRIOS)']).sort().join(',');
    if(!ref)throw new Error('não consegui ler a lista de redes do email.html');
    for(const [nome,m] of Object.entries(listas)){
      const k=chaves(m).sort().join(',');
      if(k!==ref)throw new Error('a lista de redes em '+nome+' não coincide com as outras: ['+k+'] vs ['+ref+']');
    }
    for(const r of chaves(listas['email.html (TE_SOCIAL_PROPRIOS)']).map(x=>x.slice(1,-1)))
      if(!fs.existsSync('social/'+r+'.png'))
        throw new Error(r+' está na lista mas não tem social/'+r+'.png — dá 404 dentro do email')`],
  ['abrir a pré-visualização abre mesmo', `const fs=require('fs');
    // window.open chamado com 'noopener' devolve SEMPRE null, por
    // especificação. O código guardava esse null, dava-o por janela fechada, e
    // caía no ramo de abrir depois dos awaits — que o browser bloqueia por já
    // não ser resposta directa ao clique. O botão abria um separador em branco
    // e mais nada, sem um único erro na consola.
    const h=fs.readFileSync('email.html','utf8');
    const i=h.indexOf('function _openPreviewLink');
    if(i<0)throw new Error('falta o _openPreviewLink');
    const f=h.slice(i, h.indexOf('async function _wizSendTest'));
    if(/window\\.open\\([^)]*noopener/.test(f))
      throw new Error("window.open com 'noopener' devolve null: a janela nunca pode ser navegada");
    if(!/id="wizPreviewOpen"[\\s\\S]{0,400}?href=/.test(h))
      throw new Error('o botão Abrir tem de ser um <a href> — é o browser que abre, sem bloqueios');
    if(!/function _wizPrepararPreview/.test(h)||!/_wizPrepararPreview\\(\\);/.test(h))
      throw new Error('o endereço tem de ser buscado ao entrar no passo 4, senão o href está vazio no clique')`],
  ['o número de destinatários é de pessoas', `const fs=require('fs');
    // O ecrã somava os contactos do ficheiro aos das listas. Quem está numa
    // lista E no ficheiro contava duas vezes, e quem cancelou contava como
    // quem vai receber. Num envio de 140 mil a diferença são milhares, e só
    // se via depois de enviar.
    const api=fs.readFileSync('api/campaigns/[id].js','utf8');
    const i=api.indexOf("action === 'recipient_summary'");
    if(i<0)throw new Error('falta o resumo de destinatários');
    const q=api.slice(i, api.indexOf("get_direct_recipients", i));
    if(!/BOOL_OR\\(f\\)/.test(q)||!/UNION ALL/.test(q))
      throw new Error('as duas origens têm de ser unidas por contacto, senão a intersecção conta duas vezes');
    if(!/nos_dois/.test(q))
      throw new Error('a sobreposição entre ficheiro e listas tem de ser dita — é o número que ninguém vê');
    if(!/vao_receber/.test(q)||!/estado = 'active' AND NOT suprimida/.test(q))
      throw new Error('quem vai receber tem de excluir quem cancelou e quem está na supressão');
    // Um EXISTS correlacionado dentro de cada contagem é uma consulta por
    // contacto: com a lista Marketing são 130 mil.
    if(/EXISTS \\(SELECT 1 FROM suppression/.test(q))
      throw new Error('a supressão tem de entrar como conjunto (IN), não como EXISTS por linha');
    const h=fs.readFileSync('email.html','utf8');
    if(!/_wizPedirResumo/.test(h))
      throw new Error('o painel tem de pedir o resumo ao servidor — a intersecção não se calcula no browser');
    if(!/_wizResumoTimer/.test(h))
      throw new Error('sem espera, cada clique numa lista dispara uma consulta a 130 mil contactos');
    if(!/pedido !== _wizResumoPedido/.test(h))
      throw new Error('respostas fora de ordem punham no ecrã o resumo de outra selecção')`],
  ['o motivo de exclusão é o verdadeiro', `const fs=require('fs');
    // Um endereço recusado na gravação (supressão, inválido, repetido) nunca
    // chega a existir como contacto, por isso o passo seguinte não o encontra
    // e chamava-lhe "não chegou a ser gravado". A razão certa era a supressão
    // — e essa resolve-se; "não gravado" parece uma avaria e não se faz nada.
    const c=fs.readFileSync('api/contacts/index.js','utf8');
    if(!/skipped_detail/.test(c))
      throw new Error('a gravação tem de devolver quem recusou, não só quantos');
    if(!/reason: 'suppression_dominio'/.test(c))
      throw new Error('uma supressão de domínio inteiro tem de ser nomeada como tal — é a causa mais escondida de todas');
    if(!/dominio: dom/.test(c))
      throw new Error('tem de dizer QUAL o domínio que bloqueou o endereço');
    if(!/skipped_detail\\b[\\s\\S]{0,200}return \\{ imported/.test(c.replace(/\\n/g,' '))&&!/skipped_detail \\}/.test(c))
      throw new Error('o skipped_detail tem de sair no resultado do processBatch');
    const h=fs.readFileSync('email.html','utf8');
    if(!/jaExplicados/.test(h))
      throw new Error('sem isto o mesmo endereço aparece duas vezes no CSV, com duas razões diferentes');
    if(!/r\\.excluded\\.filter\\(d => !jaExplicados\\.has/.test(h))
      throw new Error('o nao_gravado tem de ser descartado para quem já tem razão verdadeira');
    // Dois buracos por onde uma linha desaparecia sem ser contada em nada:
    // voltar do upsert sem id, e a transacção rebentar.
    if(!/todos\\.filter\\(r => !r\\.id\\)/.test(c))
      throw new Error('uma linha que volte do upsert sem id não pode desaparecer sem ser contada');
    if(!/reason: 'falha_ao_gravar'/.test(c))
      throw new Error('um bloco que rebente tem de nomear os endereços que ficaram por gravar');
    // failed:N vem com HTTP 200 — não é erro de rede, é o servidor a dizer que
    // não gravou. Se o browser não olhar para isso, o bloco não é repetido e o
    // utilizador não é avisado: os endereços só reaparecem como nao_gravado.
    if(!/if \\(grav\\?\\.failed\\) \\{/.test(h))
      throw new Error('o browser tem de reagir ao failed do bulk_import, senão um bloco perdido passa em silêncio');
    const tb=h.slice(h.indexOf('const tratarBloco'), h.indexOf('for (let i = 0; i < blocos.length'));
    if(tb.indexOf('grav?.failed') > tb.indexOf('fora.invalidos'))
      throw new Error('o failed tem de ser visto ANTES de somar contagens, senão a repetição do bloco conta tudo duas vezes')`],
  ['taxas de abertura e clique honestas', `const fs=require('fs');
    // Duas maneiras fáceis de inflacionar estes números sem ninguém reparar:
    // contar eventos em vez de pessoas (quem reabre o email conta cinco
    // vezes, e a taxa passa dos 100%), e dividir pelos destinatários em vez
    // de pelo que foi entregue. São KPIs que vão a reuniões.
    const api=fs.readFileSync('api/campaigns/index.js','utf8');
    if(!/COUNT\\(DISTINCT ee\\.contact_id\\) FILTER \\(WHERE ee\\.type='open'/.test(api))
      throw new Error('a listagem tem de contar aberturas únicas por contacto, não eventos');
    if(!/COUNT\\(DISTINCT ee\\.contact_id\\) FILTER \\(WHERE ee\\.type='click'/.test(api))
      throw new Error('a listagem tem de contar cliques únicos por contacto, não eventos');
    const h=fs.readFileSync('email.html','utf8');
    const i=h.indexOf('function _campTaxa');
    if(i<0)throw new Error('falta o _campTaxa que desenha as taxas na listagem');
    const corpo=h.slice(i,h.indexOf('function _campProgressoEnvio'));
    if(!/const base = c\\.sent_count/.test(corpo))
      throw new Error('a taxa tem de ser sobre o que foi entregue (sent_count), não sobre os destinatários');
    if(!/c\\.unique_opens/.test(corpo)||!/c\\.unique_clicks/.test(corpo))
      throw new Error('a taxa tem de usar os únicos (unique_opens/unique_clicks), não open_count/click_count');
    if(/c\\.total_recipients/.test(corpo))
      throw new Error('total_recipients como base dá uma taxa sobre endereços que não receberam nada')`],
  ['um CSV não perde linhas', `const fs=require('fs');
    // O mesmo ficheiro entrava com 1161 contactos em TXT e 630 em CSV. Não era
    // o servidor: eram linhas que nunca saíam do browser, porque o ficheiro era
    // cortado por linhas físicas. Duas coisas que um export do Excel tem quase
    // sempre — uma quebra de linha dentro de um campo entre aspas, e uma
    // vírgula dentro de um campo sem aspas ("Santos, Miguel") — davam ~50%.
    const h=fs.readFileSync('email.html','utf8');
    const bloco=(inicio)=>{const i=h.indexOf(inicio);
      if(i<0)throw new Error('não encontrei '+inicio+' no email.html');
      let d=0;for(let k=h.indexOf('{',i);k<h.length;k++){
        if(h[k]==='{')d++;else if(h[k]==='}'){d--;if(!d)return h.slice(i,k+1);}}
      throw new Error(inicio+' sem fecho');};
    const src=['function _isValidEmail','function _impStatus','function _impDate',
      'function _normCabecalho','function _csvRegistos','function _csvDelimitador',
      'function _emailNaLinha','function _parseCsv'].map(bloco).join('\\n');
    const pre='const _IMP_STATUS_HEADERS=["estado"];const _IMP_DATE_HEADERS=["data"];';
    const {_parseCsv,_emailNaLinha}=new Function(pre+src+';return {_parseCsv,_emailNaLinha};')();
    const conta=(t)=>_parseCsv(t).length;
    let a=['Notas,Email'],b=['Nome,Email'];
    for(let i=0;i<10;i++){
      a.push((i%2?'"nota\\nsegunda linha"':'nota')+',p'+i+'@caetano.pt');
      b.push((i%2?'Santos, Miguel':'Miguel')+',q'+i+'@caetano.pt');
    }
    if(conta(a.join('\\n'))!==10)throw new Error('uma quebra de linha dentro de aspas voltou a comer contactos');
    if(conta(b.join('\\n'))!==10)throw new Error('uma vírgula num campo sem aspas voltou a comer contactos');
    if(conta('a@caetano.pt\\nb@caetano.pt')!==2)throw new Error('um ficheiro sem cabeçalho tem de ser lido na mesma');
    if(conta('Nome,E-mail\\nx,c@caetano.pt')!==1)throw new Error('a coluna "E-mail" deixou de ser reconhecida');
    if(conta('Nome,Email\\rx,d@caetano.pt\\ry,e@caetano.pt')!==2)throw new Error('fim de linha CR sozinho volta a dar um ficheiro só com cabeçalho');
    if(_emailNaLinha('Miguel Santos <k@caetano.pt>')!=='k@caetano.pt')throw new Error('deixou de resgatar o email dentro de texto');
    if(conta('Nome,Email\\nx,isto-nao-e-email')!==0)throw new Error('lixo não pode virar contacto')`],
  ['tirar da supressão volta a activar', `const fs=require('fs');
    const s=fs.readFileSync('api/suppression/index.js','utf8');
    // Acrescentar uma supressão marca os contactos como suppressed (e um
    // domínio marca o domínio todo). Sem o inverso, ficavam recusados para
    // sempre — foi o que deixou 823 colegas fora de uma importação.
    if(!s.includes('async function reactivarSemSupressao'))
      throw new Error('falta a reactivação: remover uma supressão tem de pôr os contactos a receber outra vez');
    if((s.match(/reactivarSemSupressao\(\)/g)||[]).length<2)
      throw new Error('a reactivação tem de correr nos dois caminhos do DELETE (um email e vários)');
    const sql=(s.match(/UPDATE contacts SET status='active'[\\s\\S]*?RETURNING id/)||[''])[0];
    if(!sql.includes("status='suppressed'"))
      throw new Error('a reactivação tem de tocar só em quem está suppressed — nunca em quem cancelou ou foi devolvido');
    if(!sql.includes('NOT LIKE') || !sql.includes('split_part'))
      throw new Error('a reactivação tem de excluir quem continua coberto por outra supressão (email ou domínio)')`],
  ['ninguém cancelado recebe', `const fs=require('fs');
    // A barreira antes de cada lote tem de ser a mesma nos dois motores de
    // envio: já divergiram, e um verificava o que o outro não verificava.
    for(const f of ['lib/sendCampaign.js','api/campaigns/[id].js']){
      const s=fs.readFileSync(f,'utf8');
      if(!/bloquearCancelados\\(/.test(s))throw new Error(f+' não usa a barreira partilhada antes do lote');
      if(/error_message='Endereço na lista de supressão'/.test(s))throw new Error(f+' voltou a ter a sua própria barreira');
    }
    const c=fs.readFileSync('lib/campanhas.js','utf8');
    if(!/FROM suppression/.test(c))throw new Error('a barreira deixou de consultar a lista de supressão');
    if(!/FROM contacts WHERE status/.test(c))throw new Error('a barreira deixou de olhar ao estado do contacto — era este o buraco: cancelar à mão não passa pela supressão');
    for(const e of ['unsubscribed','bounced','suppressed','complained'])
      if(!c.includes("'"+e+"'"))throw new Error('a barreira deixou de contar com o estado '+e);
    if(!/NOT LIKE '@%'/.test(c)||!/LIKE '@%'/.test(c))throw new Error('a barreira deixou de tratar as supressões de domínio inteiro')`],
  ['rodapé legal opcional', `const {buildLegalFooter}=require('./lib/emailFooter');
    const o={globalDisclaimer:'aviso',email:'a@b.pt',unsubUrl:'https://e.pt/u',previewUrl:'https://e.pt/v/1/t'};
    const com=buildLegalFooter(o), sem=buildLegalFooter({...o,semRodapeLegal:true});
    for(const t of ['Este e-mail foi enviado para','500003165','Cancelar subscrição','Política de privacidade','Versão web'])
      if(!com.includes(t))throw new Error('por omissão o rodapé legal tem de levar "'+t+'"');
    for(const t of ['Este e-mail foi enviado para','500003165','Cancelar subscrição','Política de privacidade','Versão web'])
      if(sem.includes(t))throw new Error('desligado, "'+t+'" continua a sair');
    if(!/aviso/.test(sem))throw new Error('o disclaimer da área cinzenta não é afectado por esta opção');
    if(buildLegalFooter({semRodapeLegal:true})!=='')throw new Error('sem nada para mostrar o rodapé tem de vir vazio');
    // O cabeçalho de cancelamento não depende do rodapé: é ele que dá o botão
    // do Gmail quando o link no corpo não vai.
    const {listUnsubscribeHeaders}=require('./lib/rawEmail');
    if(!listUnsubscribeHeaders('https://e.pt/u')['List-Unsubscribe'])throw new Error('sem o cabeçalho não sobra mecanismo de cancelamento nenhum');
    const {semRodapeLegal}=require('./lib/campanhas');
    if(semRodapeLegal({}))throw new Error('uma campanha sem o campo tem de levar o rodapé legal');
    if(semRodapeLegal(null))throw new Error('sem campanha tem de levar o rodapé legal');
    if(!semRodapeLegal({no_legal_notice:true}))throw new Error('a opção gravada não é respeitada')`],
  ['cabeçalhos de cancelamento', `const {buildRawEmail,listUnsubscribeHeaders}=require('./lib/rawEmail');
    const u='https://emkt.caetano.pt/api/suppression?action=unsubscribe&email=a%40b.pt&token=t';
    const m=buildRawEmail({fromName:'C',fromEmail:'a@b.pt',toEmail:'c@d.pt',subject:'s',htmlBody:'h',textBody:'t',headers:listUnsubscribeHeaders(u)});
    const cab=m.split('\\r\\n\\r\\n')[0];
    if(!/^List-Unsubscribe: <https:\\/\\//m.test(cab))throw new Error('sem List-Unsubscribe — o Gmail exige-o a quem envia em volume');
    if(!/^List-Unsubscribe-Post: List-Unsubscribe=One-Click$/m.test(cab))throw new Error('sem List-Unsubscribe-Post');
    const inj=buildRawEmail({fromName:'C',fromEmail:'a@b.pt',toEmail:'c@d.pt',subject:'s',htmlBody:'h',textBody:'t',headers:{'X':'a\\r\\nBcc: v@a.pt'}});
    if(/Bcc:/.test(inj.split('\\r\\n\\r\\n')[0]))throw new Error('um valor com CRLF injectou um cabeçalho na mensagem');
    if(Object.keys(listUnsubscribeHeaders('#unsubscribe')).length)throw new Error('declarou um-clique sem endereço válido')`],
  ['metadados do editor fora do email', `const {stripEditorMetadata}=require('./lib/emailHtml');
    const h='<body>Olá</body></html><!--teBlocks:eyJ2IjoyfQ==-->';
    const r=stripEditorMetadata(h);
    if(/teBlocks/.test(r))throw new Error('o marcador dos blocos continua no email: '+r);
    if(!/Olá/.test(r))throw new Error('o conteúdo foi perdido: '+r);
    const cond='<!--[if mso | IE]><table><![endif]-->x';
    if(stripEditorMetadata(cond)!==cond)throw new Error('as condicionais do Outlook não podem ser tocadas — são elas que fazem o layout nesse cliente')`],
  ['contagem de cliques só em <a>', `const {injectTracking}=require('./lib/emailHtml');
    const h='<link href="https://fonts.googleapis.com/css?family=Roboto" rel="stylesheet"><a href="https://caetano.pt/x">i</a>';
    const r=injectTracking(h,{appUrl:'https://e.pt',campaignId:1,contactId:2,token:'T',utm:''});
    if(/<link href="https:\\/\\/e\\.pt/.test(r))throw new Error('a folha de estilo foi reescrita — cliques falsos e fonte que não carrega');
    if(!/<a href="https:\\/\\/e\\.pt\\/api\\/track/.test(r))throw new Error('o link do <a> não foi reescrito')`],
  ['texto simples sem lixo', `const {htmlToText}=require('./lib/emailHtml');
    const h='<html><head><title>t</title></head><body><!--[if mso]><xml><o:PixelsPerInch>96</o:PixelsPerInch></xml><![endif]--><div>   </div><div>Olá</div>   \\n   \\n<div>Adeus</div></body></html>';
    const t=htmlToText(h);
    if(/96/.test(t))throw new Error('o valor de PixelsPerInch entrou no texto: '+JSON.stringify(t));
    if(/^\\s+$/m.test(t))throw new Error('linhas só com espaços: '+JSON.stringify(t));
    if(t!=='Olá\\n\\nAdeus')throw new Error('resultado inesperado: '+JSON.stringify(t))`],
  ['arredondamento e banda pelos helpers', `const fs=require('fs');
    const s=fs.readFileSync('email.html','utf8');
    // O arredondamento tem de passar sempre por teRadiusVal/teRadiusCss: é o
    // que suporta um valor por canto. Escrever o campo directamente no CSS
    // faria o bloco voltar a ter os quatro cantos iguais num dos sítios.
    const direto=s.match(/border-radius:\\\${1}\\{b\\.[A-Za-z]*[Rr]adius/g);
    if(direto)throw new Error('há '+direto.length+' sítio(s) a escrever o arredondamento sem o helper: '+direto.join(', '));
    for(const h of ['function teRadiusVal','function teRadiusCss','function teBanda','function teBandaHtml'])
      if(!s.includes(h))throw new Error('falta '+h+' — os três desenhos (canvas, HTML e MJML) partilham-nos');
    // A banda tem de ser desenhada nos três, senão o editor mostra uma coisa
    // e o email envia outra.
    const usos=(s.match(/teBanda\\(b\\)/g)||[]).length;
    if(usos<6)throw new Error('a banda só é usada '+usos+' vez(es): faltam desenhos (esperado 2 por cada um dos 3)')`],
  ['contactos sem marca', `const fs=require('fs');
    const codigo=(f)=>fs.readFileSync(f,'utf8').split('\\n').filter(l=>!/^\\s*(\\/\\/|--|\\*)/.test(l)).join('\\n');
    const ins=codigo('lib/contactos.js');
    if(/INSERT INTO contacts[^\`]*brand_id/.test(ins))throw new Error('lib/contactos.js volta a gravar brand_id — os contactos são globais e a coluna deixa de existir na 051');
    for(const f of ['api/contacts/index.js','api/contacts/[id].js','api/sync/index.js']){
      const s=codigo(f);
      if(/c\\.brand_id|contacts\\.brand_id|contacts SET brand_id/.test(s))throw new Error(f+' volta a usar a marca do contacto');
    }
    const c=codigo('api/contacts/index.js');
    if(/brand_id obrigatório'\\s*\\}\\);\\s*$/m.test(c.split('ACCOES_POR_MARCA')[0]))throw new Error('o brand_id volta a ser obrigatório em /api/contacts');
    if(!/hasAnyRole/.test(c))throw new Error('/api/contacts deixou de verificar o acesso quando não recebe marca')`],
  ['link da versão web', `const p=require('./lib/previewLink');const t=p.previewToken(74);
    if(!p.previewTokenValido(74,t))throw new Error('token novo recusado');
    if(!p.previewTokenValido(74,p.previewTokenLegacy(74)))throw new Error('token antigo recusado — links já enviados deixariam de abrir');
    if(p.previewTokenValido(75,t))throw new Error('token aceite noutra campanha');
    if(!/^https:\\/\\/exemplo\\.pt\\/v\\/74\\/[A-Za-z0-9_-]{16}$/.test(p.previewUrl('https://exemplo.pt',74)))throw new Error('formato do link inesperado: '+p.previewUrl('https://exemplo.pt',74))`],
];
for (const [nome, codigo] of provas) {
  try { correr(codigo); console.log('  ok    ', nome); }
  catch (e) { falhas++; console.error('  erro  ', nome, '->', String(e.stderr || '').split('\n').find(l => /Error/.test(l)) || ''); }
}

console.log(falhas ? `\n${falhas} problema(s).` : '\nTudo ok.');
process.exit(falhas ? 1 : 0);
