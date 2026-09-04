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
