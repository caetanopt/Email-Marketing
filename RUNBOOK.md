# Runbook
Caetano eMKT — Plataforma de Email Marketing

URL: email-marketing-eta.vercel.app *(ou o domínio próprio configurado em `APP_URL`)*

---

## 1. Dados — Supabase (PostgreSQL) + Vercel Blob

Toda a informação da plataforma (utilizadores, marcas, contactos, listas, campanhas, templates, log de envios, supressões) vive numa base de dados **PostgreSQL no Supabase**, acedida via `pg` (`lib/db.js`) através do pooler de ligação (porta 6543). Logos/media de marca são guardados no **Vercel Blob** (`@vercel/blob`) — **anexos de campanhas NÃO usam o Blob**: ficam em base64 numa coluna JSONB (`campaigns.attachments`, migração 038) e são enviados inline como MIME raw via SES (ver risco abaixo).

Variáveis de ambiente relevantes (Vercel): `DATABASE_URL`, `JWT_SECRET`, `BLOB_READ_WRITE_TOKEN`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `SES_RATE`, `SES_RATE_PER_SECOND`, `SES_BATCH_SIZE`, `APP_URL`, `ANTHROPIC_API_KEY`, `CRON_SECRET`, `MAGIC_LINK_FROM`, `FROM_DOMAIN`, `COMPANY_ADDRESS`, `CRON_MAX_SECONDS`. **Nota:** `.env.example` está desactualizado — lista variáveis `SMTP_*` que já não são usadas em lado nenhum (o envio é feito directamente via AWS SDK/SES, não SMTP) e omite todas as variáveis reais acima.

### Migrações de base de dados

O esquema é gerido por ficheiros SQL numerados em `migrations/` (001 a 039, 41 ficheiros no total — os números 030 e 031 estão duplicados: `030_admins_all_brands.sql`/`030_brand_api_key.sql` e `031_cleanup_orphan_templates.sql`/`031_domain_whitelist.sql`). **Não há execução automática**: sempre que uma alteração de código inclui uma nova migração, é preciso abrir o Supabase → SQL Editor e correr o conteúdo do ficheiro manualmente. O código tem alguns fallbacks defensivos (`_migration_pending: true` quando apanha o erro Postgres `42P01 — undefined_table`), mas isso só evita um crash total; a funcionalidade em si não funciona até a migração ser corrida.

### O que pode correr mal

- **Migração por correr** — erro `42P01` (tabela/coluna em falta) ou a funcionalidade devolve dados vazios com `_migration_pending: true`. Correr o SQL da migração em falta no Supabase SQL Editor.
- **`DATABASE_URL` inválida, em falta, ou pooler em baixo** — `lib/db.js` lança erro **no `require()`**, não por pedido; isto faz a função serverless falhar a arrancar (aparece na Vercel como `FUNCTION_INVOCATION_FAILED`, não como um JSON de erro normal) em qualquer rota que importe `lib/db.js`. Verificar a variável na Vercel e o estado do projecto no Supabase.
- **`JWT_SECRET` alterado ou em falta** — mesmo comportamento de falha no arranque (`lib/auth.js`); todos os utilizadores são desautenticados de repente (tokens deixam de validar — sessões duram 7 dias, `expiresIn:'7d'`). Nunca alterar sem coordenar.
- **`BLOB_READ_WRITE_TOKEN` em falta** — só afecta upload de **logo/media de marca** (`api/brands/index.js`), que falha com `503 BLOB_READ_WRITE_TOKEN não configurado na Vercel`. Não afecta anexos de campanhas.
- **Anexos de campanha grandes** — como vão em base64 dentro da própria linha da BD e depois inline no email MIME raw, campanhas com anexos volumosos/múltiplos podem ultrapassar o limite de 10MB de mensagem raw do SES e falhar o envio sem aviso claro na UI.

---

## 2. Aplicação — Node.js (Serverless) no Vercel

Aplicação Node.js sem framework, funções serverless puras (`module.exports = async (req, res) => {...}`) na pasta `api/`. Não há router central — cada ficheiro/pasta em `api/` é um endpoint, e o `vercel.json` faz `rewrites` para mapear rotas amigáveis (ex.: `/api/campaigns/:id` → `/api/campaigns?id=:id`). O frontend é uma **SPA single-file** (`email.html`, ~14.500 linhas) com Tailwind CSS embutido — sem build step, servido directamente como HTML estático.

| Pasta / Ficheiro | Função |
|---|---|
| `email.html` | Frontend inteiro (SPA): editor de campanhas/templates, dashboard, gestão de contactos/listas, definições. Todo o JS embutido. |
| `api/auth.js` | Login via magic link, sessões JWT (7 dias), gestão de utilizadores e roles (`owner`, `editor`, `viewer`) |
| `api/campaigns/` | CRUD de campanhas, envio, agendamento, relatórios |
| `api/contacts/` | CRUD de contactos, importação em massa (`import_process`, via cron) |
| `api/lists/` | Listas de contactos (incl. listas globais/fixas) |
| `api/brands/` | Gestão de marcas, logos, variáveis de marca, permissões por área |
| `api/templates/` | Templates de email, geração de MJML por IA (imagem → MJML, requer `ANTHROPIC_API_KEY`) |
| `api/suppression/` | Supressões/unsubscribes (por marca e globais) |
| `api/sync/` | Sincronização de dados |
| `api/icons/` | Ícones personalizados usados no editor |
| `api/track.js` | Tracking de abertura/clique, preview de campanhas, webhooks |
| `lib/db.js` | Ligação PostgreSQL (pool `pg`) |
| `lib/ses.js` | Cliente Amazon SES |
| `lib/sendCampaign.js` | Motor de envio: batching, rate limit, quota SES, tracking, retries |
| `lib/auth.js` | Helpers de autenticação/CORS partilhados pelas rotas |
| `migrations/` | Esquema da BD (correr manualmente no Supabase) |
| `primemail/` | Protótipo Laravel/Vue anterior — **não está em produção**, ver nota abaixo |

> **Nota:** a pasta `docs/` e o `README.md` descrevem uma arquitetura-alvo em Laravel + Vue + MySQL + Redis que nunca chegou a substituir a implementação actual. O que está realmente em produção é o stack Node.js + Postgres (Supabase) + `email.html` descrito acima.

### Regras de negócio principais

- **Autenticação** — **só por magic link** (não existe login por palavra-passe; não há campo de password nem hashing no schema/código). `api/auth.js` envia um link por email com token válido 15 min; a sessão resultante é um JWT válido 7 dias (`JWT_SECRET`). Roles por marca em `user_brand_roles`, valores exactos `owner`/`editor`/`viewer` (a role `admin` existiu e foi removida na migração 025).
- **Multi-marca** — todo o dado (campanhas, listas, contactos, templates) está associado a uma `brand_id`. Utilizadores podem ter acesso a várias marcas com roles diferentes em cada.
- **Envio de campanhas** — motor em `lib/sendCampaign.js`, via Amazon SES. Lê o rate limit em `global_settings.ses_rate_per_second` (fallback `SES_RATE_PER_SECOND`, depois 50/s), limitado também por `SES_RATE`/`SES_BATCH_SIZE` (default 500 por lote) para caber no timeout de 60s da função Vercel (`maxDuration` definido em `vercel.json` só para `campaigns/*`). Antes de cada lote verifica a quota diária do SES; se esgotada, o código **não agenda retoma nenhuma** — só marca `quotaExhausted` e deixa os destinatários `pending`. A retoma depende inteiramente do cron externo continuar a chamar `/api/cron` depois da quota SES resetar à meia-noite UTC; se o cron parar, os envios ficam presos indefinidamente sem qualquer alerta automático.
- **Cron / agendamento** — `/api/cron` (→ `campaigns?action=process-scheduled`) e `/api/cron/import` (→ `contacts?action=import_process`) são chamados por um agendador **externo** (não há cron nativo da Vercel configurado neste projecto). **Assimetria de segurança**: `/api/cron` está deliberadamente **sem autenticação** (endpoint público, é idempotente/no-op se nada estiver agendado); `/api/cron/import` **exige** o header `CRON_SECRET`. Se campanhas agendadas não saírem à hora certa, verificar primeiro se o serviço de cron externo está a chamar estes endpoints.
- **Supressões** — geridas numa única tabela `suppression` (não uma tabela `global_suppression` separada): a migração 014 tornou `brand_id` anulável e adicionou uma constraint única global por `email`. Um registo com `brand_id IS NULL` é uma supressão **global** (não recebe de nenhuma marca); com `brand_id` preenchido é supressão só dessa marca.
- **Classificação de erros SES** — falhas transitórias (`Throttling`, `ServiceUnavailable`, `RequestTimeout`, `ECONNRESET`, `ETIMEDOUT`) são retentadas até 2×; a detecção de quota esgotada é feita por **regex no texto da mensagem de erro** (`Daily message quota exceeded|quota.*exceeded|DailyQuota`) — uma alteração da AWS ao texto do erro pode silenciosamente deixar de accionar a pausa de quota.
- **Protecção contra envio duplicado** — `initCampaignSend`/`runBatch` usam `UPDATE...RETURNING`/`FOR UPDATE SKIP LOCKED` para evitar que chamadas concorrentes (cron + utilizador a clicar "enviar" ao mesmo tempo) disparem o mesmo lote duas vezes.

### O que pode correr mal

- **Emails não saem** — verificar `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (sem eles, o envio termina com `warning: 'AWS SES não configurado'` sem erro visível ao utilizador). Confirmar também a quota SES em `SentLast24Hours`/`Max24HourSend`.
- **Ninguém consegue entrar na plataforma** — como não há password de recurso, uma falha no SES (envio do magic link) bloqueia o login de **todos** os utilizadores ao mesmo tempo. Verificar SES antes de qualquer outra hipótese.
- **Geração de template por IA falha** — `ANTHROPIC_API_KEY` em falta devolve `503 ANTHROPIC_API_KEY não configurada` no endpoint `/api/ai/image-to-mjml`.
- **Links de cancelamento/tracking apontam para o domínio errado** — `APP_URL` desalinhado com o domínio real de produção. Corrigir na Vercel e fazer redeploy.
- **Importação de contactos em massa não avança** — depende do cron externo chamar `/api/cron/import` (com `CRON_SECRET`) repetidamente; confirmar que o agendador externo está activo e a enviar o segredo correcto.
- **"Erro ao apagar roles" / utilizador não consegue perder acesso a uma marca** — falha a apagar de `user_brand_roles`; verificar logs da função `api/auth.js`.

---

## 3. Deploy — GitHub + Vercel

Qualquer commit nas branches `claude/email-marketing-saas-M2qZP` ou `claude/resume-login-error-FVgtn` dispara o workflow `.github/workflows/deploy.yml`, que corre `npx vercel --prod --yes` com os segredos `VERCEL_TOKEN`, `VERCEL_ORG_ID` e `VERCEL_PROJECT_ID` (definidos em GitHub → Settings → Secrets). A integração Git nativa da Vercel está desactivada (`"github": { "enabled": false }` em `vercel.json`) — o GitHub Action é o único mecanismo de deploy.

Repositório: `github.com/mktcaetanoretail-png/email-marketing`

IDs Vercel: equipa `team_jf00Jpfp6cElvXAfxaxVal0Q`, projecto `prj_8h1BsSA38ium1KAi543djG6sbnV8`.

### O que pode correr mal

- **Deploy não aparece na Vercel** — ver o workflow em GitHub → Actions. Causa comum: `VERCEL_TOKEN` expirado; gerar novo token na Vercel e actualizar o secret.
- **Deploy só corre nas branches listadas** — um commit numa branch nova/diferente não dispara nada; é preciso adicionar a branch ao `on.push.branches` do `deploy.yml`.
- **Função de campanhas atinge timeout** — `api/campaigns/index.js` e `api/campaigns/[id].js` têm `maxDuration: 60`; envios muito grandes devem ser processados em lotes (já é o comportamento por defeito) em várias invocações sucessivas do cron, não numa só chamada.
- **CORS bloqueado numa chamada à API** — os headers CORS globais estão definidos em `vercel.json` para `/api/(.*)`; se um endpoint novo não herdar isto, confirmar que está dentro de `api/`.

---

## Contactos e Acessos

| Sistema | Acesso |
|---|---|
| Supabase (BD) | Conta associada ao projecto — SQL Editor para migrações |
| GitHub + Vercel | Conta associada ao repositório `mktcaetanoretail-png` |
| Amazon SES | Credenciais IAM (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`), região `eu-west-1` por defeito |
| Plataforma (admin) | `marketing@caetano.pt` e restantes contas geridas em Definições → Utilizadores |

---

## Contexto para Claude Code

Se precisares de ajuda técnica com este sistema, cola o seguinte prompt no Claude Code:

```
Estou a trabalhar no Caetano eMKT — uma plataforma SaaS de email marketing
multi-marca para o Grupo Caetano (concessionários automóvel em Portugal).
O sistema tem três componentes:

1. Dados — Supabase: PostgreSQL guarda utilizadores, marcas, contactos,
listas, campanhas, templates, log de envios e supressões. Só logos/media
de marca vivem no Vercel Blob — anexos de campanha ficam em base64 numa
coluna JSONB e são enviados inline via SES (cuidado com o limite de
10MB de mensagem raw do SES). O esquema é gerido por migrações SQL
manuais em migrations/ (correr no Supabase SQL Editor — não há
execução automática).

2. Aplicação — Node.js serverless no Vercel (sem framework), pasta api/
com um ficheiro/rota por endpoint (auth, campaigns, contacts, lists,
brands, templates, suppression, sync, icons, track). Frontend é uma SPA
single-file em email.html (Tailwind embutido, sem build step). Motor de
envio em lib/sendCampaign.js via Amazon SES, com rate limiting, batching
(60s de timeout por função) e verificação de quota diária (sem retoma
automática — depende do cron externo continuar a chamar /api/cron).
Autenticação é SÓ por magic link (sem password), JWT de sessão válido
7 dias, roles por marca (owner/editor/viewer) em user_brand_roles.
Agendamento de campanhas (/api/cron, sem autenticação) e importação de
contactos (/api/cron/import, exige header CRON_SECRET) dependem de um
cron EXTERNO. Geração de template por IA (image-to-mjml) exige
ANTHROPIC_API_KEY.

3. Deploy — commit nas branches claude/* configuradas dispara
.github/workflows/deploy.yml (npx vercel --prod com os secrets
VERCEL_TOKEN/VERCEL_ORG_ID/VERCEL_PROJECT_ID). A integração Git nativa
da Vercel está desligada — o GitHub Action é o mecanismo oficial.
Repositório: github.com/mktcaetanoretail-png/email-marketing.

Ajuda-me com o seguinte: [descreve o problema ou alteração]
```
