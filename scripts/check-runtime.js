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
