#!/bin/bash
# Gera um HTML com todos os documentos e abre servidor local

OUTPUT="/home/user/Email-Marketing/preview.html"

cat > "$OUTPUT" << 'HTML_HEADER'
<!DOCTYPE html>
<html lang="pt">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Caetano PrimeMail — Documentação</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0d1117; color: #e6edf3; }
  .sidebar { position: fixed; top: 0; left: 0; width: 260px; height: 100vh; background: #161b22; border-right: 1px solid #30363d; overflow-y: auto; padding: 16px 0; z-index: 10; }
  .sidebar h2 { color: #58a6ff; font-size: 13px; font-weight: 600; padding: 8px 16px; text-transform: uppercase; letter-spacing: .8px; }
  .sidebar a { display: block; padding: 7px 16px; color: #8b949e; text-decoration: none; font-size: 13px; border-left: 3px solid transparent; transition: all .15s; }
  .sidebar a:hover { color: #e6edf3; background: #21262d; border-left-color: #58a6ff; }
  .sidebar a.active { color: #58a6ff; background: #1f2937; border-left-color: #58a6ff; font-weight: 600; }
  .sidebar .brand { padding: 16px; border-bottom: 1px solid #30363d; margin-bottom: 8px; }
  .sidebar .brand h1 { font-size: 15px; color: #e6edf3; }
  .sidebar .brand span { font-size: 11px; color: #8b949e; }
  .content { margin-left: 260px; padding: 40px 48px; max-width: 960px; }
  .doc-section { display: none; }
  .doc-section.active { display: block; }
  h1 { font-size: 28px; color: #e6edf3; border-bottom: 1px solid #30363d; padding-bottom: 12px; margin-bottom: 24px; }
  h2 { font-size: 22px; color: #e6edf3; margin: 32px 0 12px; border-bottom: 1px solid #21262d; padding-bottom: 8px; }
  h3 { font-size: 17px; color: #e6edf3; margin: 24px 0 8px; }
  h4 { font-size: 15px; color: #8b949e; margin: 16px 0 6px; }
  p { line-height: 1.7; color: #c9d1d9; margin: 10px 0; }
  a { color: #58a6ff; text-decoration: none; }
  a:hover { text-decoration: underline; }
  code { background: #1c2128; border: 1px solid #30363d; border-radius: 4px; padding: 2px 6px; font-family: 'JetBrains Mono', 'Fira Code', monospace; font-size: 13px; color: #ff7b72; }
  pre { background: #1c2128; border: 1px solid #30363d; border-radius: 8px; padding: 20px; overflow-x: auto; margin: 16px 0; }
  pre code { background: none; border: none; padding: 0; color: #e6edf3; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px; }
  th { background: #161b22; color: #8b949e; padding: 10px 14px; text-align: left; border: 1px solid #30363d; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .5px; }
  td { padding: 10px 14px; border: 1px solid #30363d; color: #c9d1d9; }
  tr:hover td { background: #161b22; }
  blockquote { border-left: 4px solid #58a6ff; background: #1c2128; padding: 12px 16px; margin: 16px 0; border-radius: 0 6px 6px 0; }
  blockquote p { color: #8b949e; margin: 0; font-style: italic; }
  ul, ol { padding-left: 24px; margin: 10px 0; }
  li { line-height: 1.8; color: #c9d1d9; }
  hr { border: none; border-top: 1px solid #30363d; margin: 32px 0; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; margin-left: 6px; }
  .badge-blue { background: #1d3557; color: #58a6ff; }
  .toc-num { color: #30363d; font-size: 11px; margin-right: 6px; }
</style>
</head>
<body>
<nav class="sidebar">
  <div class="brand">
    <h1>Caetano PrimeMail</h1>
    <span>Documentação Técnica v1.0</span>
  </div>
  <h2>Documentos</h2>
HTML_HEADER

# Gera links da sidebar
FILES=(
  "README.md:readme:Início / Índice"
  "docs/01-product-vision.md:01:01 — Visão do Produto"
  "docs/02-features.md:02:02 — Funcionalidades"
  "docs/03-mvp.md:03:03 — Definição de MVP"
  "docs/04-technical-architecture.md:04:04 — Arquitetura Técnica"
  "docs/05-data-architecture.md:05:05 — Arquitetura de Dados"
  "docs/06-performance-strategy.md:06:06 — Estratégia de Performance"
  "docs/07-import-flow.md:07:07 — Fluxo de Importação"
  "docs/08-authentication-flow.md:08:08 — Autenticação e Login"
  "docs/09-security.md:09:09 — Segurança e RGPD"
  "docs/10-ux-dashboard.md:10:10 — UX / Dashboard"
  "docs/11-api-code-organization.md:11:11 — API e Código"
  "docs/12-roadmap.md:12:12 — Roadmap por Fases"
  "docs/13-risks.md:13:13 — Riscos e Mitigação"
  "docs/14-summary.md:14:14 — Resumo Executivo"
  "docs/15-user-stories.md:15:15 — User Stories"
  "docs/16-non-functional-requirements.md:16:16 — Requisitos NF"
  "docs/17-development-order.md:17:17 — Ordem de Desenvolvimento"
)

FIRST=true
for entry in "${FILES[@]}"; do
  IFS=':' read -r file id label <<< "$entry"
  if [ "$FIRST" = true ]; then
    echo "  <a href=\"#\" onclick=\"showDoc('$id')\" class=\"active\" id=\"nav-$id\">$label</a>" >> "$OUTPUT"
    FIRST=false
  else
    echo "  <a href=\"#\" onclick=\"showDoc('$id')\" id=\"nav-$id\">$label</a>" >> "$OUTPUT"
  fi
done

echo "</nav><main class=\"content\">" >> "$OUTPUT"

# Gera conteúdo de cada ficheiro
FIRST=true
for entry in "${FILES[@]}"; do
  IFS=':' read -r file id label <<< "$entry"
  if [ "$FIRST" = true ]; then
    echo "<div class=\"doc-section active\" id=\"doc-$id\">" >> "$OUTPUT"
    FIRST=false
  else
    echo "<div class=\"doc-section\" id=\"doc-$id\">" >> "$OUTPUT"
  fi
  marked "/home/user/Email-Marketing/$file" >> "$OUTPUT" 2>/dev/null || echo "<p><em>Ficheiro não encontrado</em></p>" >> "$OUTPUT"
  echo "</div>" >> "$OUTPUT"
done

cat >> "$OUTPUT" << 'HTML_FOOTER'
</main>
<script>
function showDoc(id) {
  document.querySelectorAll('.doc-section').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.sidebar a').forEach(el => el.classList.remove('active'));
  document.getElementById('doc-' + id).classList.add('active');
  document.getElementById('nav-' + id).classList.add('active');
  window.scrollTo(0, 0);
}
</script>
</body>
</html>
HTML_FOOTER

echo "✅ preview.html gerado!"
