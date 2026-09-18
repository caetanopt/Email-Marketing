// Auditoria de contraste (WCAG AA) do painel, ecrã a ecrã.
//
// Porquê existe: o tema escuro não usa as variantes dark: do Tailwind — é uma
// lista de remapeamentos escrita à mão no <style> do email.html. Uma classe
// clara que não esteja nessa lista fica clara, e ninguém dá por isso até
// alguém abrir o ecrã no tema escuro. Foi assim que text-slate-800 ficou com
// rácio 1,0 (texto da mesma cor do fundo) em 29 sítios.
//
// Esta auditoria mede em vez de adivinhar: injecta o CSS real do Tailwind,
// percorre os ecrãs e calcula o rácio de contraste de cada elemento com texto
// contra o fundo efectivo, compondo transparências pela cadeia de ascendentes.
//
// COMO CORRER (precisa de duas ferramentas que não são dependências do
// projecto, por isso instalam-se à parte):
//
//   npm i -g playwright && npx playwright install chromium
//   mkdir -p /tmp/tw && cd /tmp/tw && npm i tailwindcss@3.4.17
//   printf '@tailwind base;@tailwind utilities;' > in.css
//   npx tailwindcss --content /caminho/email.html -i in.css -o out.css --minify
//   TW_CSS=/tmp/tw/out.css TEMA=dark node scripts/contraste.js
//
// TEMA=dark|light (por omissão dark). Sai com código 1 se houver falhas, para
// poder entrar num CI.
const { chromium } = require('playwright');
const fs = require('fs');
const CSS = fs.readFileSync(process.env.TW_CSS || '/tmp/tw/out.css', 'utf8');
const TEMA = process.env.TEMA === 'light' ? 'light' : 'dark';

const ECRAS = ['dashboard','campaigns','campaignCreate','campaignShow','campaignReport','contacts','contactShow',
  'media','icons','blocks','templateEdit','lists','imports','suppression','globalSettings','team',
  'brandSettings','listEdit','statistics','userProfile','login'];

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  p.on('pageerror', e => { if (!/tailwind/i.test(e.message)) console.error('  JS:', e.message); });
  await p.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await p.route('**/cdn.tailwindcss.com/**', r => r.abort());
  await p.goto('file:///home/user/Email-Marketing/email.html');
  await p.waitForTimeout(1000);
  await p.addStyleTag({ content: CSS });
  await p.evaluate((TEMA_DARK) => {
    if (TEMA_DARK) document.documentElement.classList.add('dark'); else document.documentElement.classList.remove('dark');
    try { localStorage.setItem('pm_theme', TEMA_DARK ? 'dark' : 'light'); } catch(e){}
    injectSidebar();
  }, TEMA === 'dark');
  await p.waitForTimeout(500);

  const FUNDO = TEMA === 'dark' ? [11,18,32] : [248,250,252];
  const AUDIT = (TEMA_FUNDO) => {
    const lum = ([r,g,b]) => { const f=v=>{v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4);}; return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b); };
    const ratio = (a,b) => { const [l1,l2]=[lum(a),lum(b)].sort((x,y)=>y-x); return (l1+0.05)/(l2+0.05); };
    const parse = s => { const m=String(s).match(/rgba?\(([^)]+)\)/); if(!m) return null; const v=m[1].split(',').map(Number); return {rgb:[v[0],v[1],v[2]], a:v.length>3?v[3]:1}; };
    const over = (fg,bg) => fg.rgb.map((c,i)=> Math.round(c*fg.a + bg[i]*(1-fg.a)));
    const fundoDe = el => {
      let cur = el, acc = null;
      while (cur && cur !== document.documentElement) {
        const c = parse(getComputedStyle(cur).backgroundColor);
        if (c && c.a > 0) { acc = acc ? over({rgb:acc,a:1}, c.rgb) : (c.a<1 ? null : c.rgb); if (c.a === 1) return acc || c.rgb; }
        cur = cur.parentElement;
      }
      return TEMA_FUNDO;
    };
    const out = [];
    const vistos = new Set();
    document.querySelectorAll('*').forEach(el => {
      if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return;
      // só elementos com texto directo
      const txt = [...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent.trim()).join(' ').trim();
      if (!txt || txt.length < 2) return;
      const st = getComputedStyle(el);
      const fg = parse(st.color); if (!fg) return;
      const bg = fundoDe(el);
      const cor = over(fg, bg);
      const cr = ratio(cor, bg);
      const px = parseFloat(st.fontSize), bold = parseInt(st.fontWeight,10) >= 700;
      const limite = (px >= 24 || (px >= 18.66 && bold)) ? 3 : 4.5;
      if (cr < limite) {
        const cls = (el.className && typeof el.className === 'string' ? el.className : '').split(/\s+/)
          .filter(c => /^(text|bg)-/.test(c)).join(' ');
        const chave = cls + '|' + Math.round(cr*10) + '|' + txt.slice(0,20);
        if (vistos.has(chave)) return; vistos.add(chave);
        out.push({ cr: +cr.toFixed(2), limite, txt: txt.slice(0,44), cls, tag: el.tagName.toLowerCase(),
                   cor: st.color, fundo: 'rgb('+bg.join(',')+')' });
      }
    });
    return out.sort((a,b)=>a.cr-b.cr);
  };

  const todos = {};
  for (const ecra of ECRAS) {
    try { await p.evaluate(s => showScreen(s), ecra); } catch { continue; }
    await p.waitForTimeout(280);
    const r = await p.evaluate(AUDIT, FUNDO);
    if (r.length) todos[ecra] = r;
  }

  // painel de marcas, que é sobreposto
  await p.evaluate((TEMA_DARK) => { showScreen('campaigns'); [...document.querySelectorAll('.sidebar-brand-block')].find(e=>e.offsetParent!==null)?.click(); });
  await p.waitForTimeout(400);
  const pan = await p.evaluate(AUDIT, FUNDO);
  if (pan.length) todos['[painel de marcas]'] = pan;
  

  if (process.env.SAIDA) fs.writeFileSync(process.env.SAIDA, JSON.stringify(todos,null,1));

  // agregado por classe
  const porClasse = {};
  for (const [ecra, itens] of Object.entries(todos))
    for (const i of itens) {
      const k = i.cls || '(sem classe de cor)';
      porClasse[k] = porClasse[k] || { n:0, pior:99, ecras:new Set(), ex:i.txt };
      porClasse[k].n++; porClasse[k].pior = Math.min(porClasse[k].pior, i.cr); porClasse[k].ecras.add(ecra);
    }
  console.log('=== ECRÃS COM PROBLEMAS ===');
  Object.entries(todos).sort((a,b)=>b[1].length-a[1].length).forEach(([e,i])=>console.log(String(i.length).padStart(4), e));
  console.log('\n=== POR CLASSE (pior rácio, nº de ocorrências, exemplo) ===');
  Object.entries(porClasse).sort((a,b)=>a[1].pior-b[1].pior).slice(0,26).forEach(([c,v])=>
    console.log(String(v.pior).padStart(5), '|', String(v.n).padStart(3), '|', c.slice(0,46).padEnd(46), '|', v.ex.slice(0,26)));
  const total = Object.values(todos).reduce((a,v)=>a+v.length,0);
  console.log(`\n${total} elemento(s) abaixo do minimo WCAG AA no tema ${TEMA}.`);
  await b.close();
  process.exit(total ? 1 : 0);
})();
