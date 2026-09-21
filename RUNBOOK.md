# Runbook
Caetano eMKT — Plataforma de Email Marketing

URL: email-marketing-eta.vercel.app *(ou o domínio próprio configurado em `APP_URL`)*

---

## 1. Dados — Supabase (PostgreSQL) + Vercel Blob

Toda a informação da plataforma (utilizadores, marcas, contactos, listas, campanhas, templates, log de envios, supressões) vive numa base de dados **PostgreSQL no Supabase**, acedida via `pg` (`lib/db.js`) através do pooler de ligação (porta 6543). Logos/media de marca são guardados no **Vercel Blob** (`@vercel/blob`) — **anexos de campanhas NÃO usam o Blob**: ficam em base64 numa coluna JSONB (`campaigns.attachments`, migração 038) e são enviados inline como MIME raw via SES (ver risco abaixo).

Variáveis de ambiente relevantes (Vercel): `DATABASE_URL`, `JWT_SECRET`, `BLOB_READ_WRITE_TOKEN`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `SES_RATE`, `SES_RATE_PER_SECOND`, `SES_BATCH_SIZE`, `APP_URL`, `ANTHROPIC_API_KEY`, `CRON_SECRET`, `CRON_TRIGGER_SECRET`, `MAGIC_LINK_FROM`, `FROM_DOMAIN`, `COMPANY_ADDRESS`, `CRON_MAX_SECONDS`, `CRON_BATCH_RESERVE_MS`, `SNS_TOPIC_ARNS`, `SES_CONFIGURATION_SET`, `SES_LIMITE_DIARIO`. **Nota:** `.env.example` está desactualizado — lista variáveis `SMTP_*` que já não são usadas em lado nenhum (o envio é feito directamente via AWS SDK/SES, não SMTP) e omite todas as variáveis reais acima.

As três últimas são **opcionais e sem valor por omissão**: enquanto não forem definidas, o sistema comporta-se exactamente como antes de existirem. Ver a secção 4.

### Migrações de base de dados

O esquema é gerido por ficheiros SQL numerados em `migrations/` (001 a 066 — os números 030 e 031 estão duplicados: `030_admins_all_brands.sql`/`030_brand_api_key.sql` e `031_cleanup_orphan_templates.sql`/`031_domain_whitelist.sql`). **Não há execução automática**: sempre que uma alteração de código inclui uma nova migração, é preciso abrir o Supabase → SQL Editor e correr o conteúdo do ficheiro manualmente. O código tem alguns fallbacks defensivos (`_migration_pending: true` quando apanha o erro Postgres `42P01 — undefined_table`), mas isso só evita um crash total; a funcionalidade em si não funciona até a migração ser corrida.

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
| `lib/snsSignature.js` | Validação da assinatura das notificações SNS da Amazon |
| `migrations/` | Esquema da BD (correr manualmente no Supabase) |
| `scripts/check-runtime.js` | Sondas de regressão estáticas — correr antes de cada entrega |
| `scripts/carga.js` | Arnês de carga (ver o cabeçalho: **não correr contra produção**) |

> **Nota:** a pasta `docs/` descreve uma arquitetura-alvo em Laravel + Vue + MySQL + Redis que nunca chegou a substituir a implementação actual. Vale como intenção de produto, não como descrição do sistema: o que está em produção é o stack Node.js + Postgres (Supabase) + `email.html` descrito acima. A pasta `primemail/`, com o protótipo Laravel/Vue, foi retirada do repositório — ia em cada deploy sem nunca ser servida. Continua no histórico de git — `git checkout 1e49f29 -- primemail` traz a pasta de volta tal como estava.

### Regras de negócio principais

- **Autenticação** — **só por magic link** (não existe login por palavra-passe; não há campo de password nem hashing no schema/código). `api/auth.js` envia um link por email com token válido 15 min; a sessão resultante é um JWT válido 7 dias (`JWT_SECRET`). Roles por marca em `user_brand_roles`, valores exactos `owner`/`editor`/`viewer` (a role `admin` existiu e foi removida na migração 025).
- **Multi-marca** — as campanhas e os templates estão associados a uma `brand_id`; os utilizadores podem ter acesso a várias marcas com roles diferentes em cada. **As listas de email e os contactos são globais**: não pertencem a nenhuma marca (migrações 049 e 051). Um email é um contacto só, partilhado por todas as marcas — era assim que o envio já os tratava, juntando-os com `DISTINCT ON (lower(email))`. Nas APIs `/api/contacts` e `/api/sync` o `brand_id` deixou de ser obrigatório e deixou de filtrar contactos; continua a ser exigido nas acções de importação (`?action=import_*`, `?action=imports`), porque o histórico de importações é que é por marca.
- **Cancelamentos via `DELETE /api/sync`** — com `list_id` remove a pessoa **só daquela lista** (apaga a linha de `list_members`) e não toca na supressão, por isso continua a receber das outras listas; a resposta traz `scope: "lista"`. Sem `list_id` é cancelamento total: marca o contacto `unsubscribed` e insere o email em `suppression`, que é global — deixa de receber de qualquer lista e de qualquer marca, o mesmo efeito do link de cancelamento nos emails; a resposta traz `scope: "global"`. A supressão não se desfaz pela API (só em Supressões, na aplicação).
- **Envio de campanhas** — motor em `lib/sendCampaign.js`, via Amazon SES. Lê o rate limit em `global_settings.ses_rate_per_second` (fallback `SES_RATE_PER_SECOND`, depois 50/s), limitado também por `SES_RATE`/`SES_BATCH_SIZE` (default 500 por lote) para caber no timeout de 60s da função Vercel (`maxDuration` definido em `vercel.json` só para `campaigns/*`). Antes de cada lote verifica a quota diária do SES (e o tecto de aquecimento `SES_LIMITE_DIARIO`, se definido); se esgotada, o código **não agenda retoma nenhuma** — só marca `quotaExhausted` e devolve os destinatários a `pending`. A retoma depende inteiramente do cron externo continuar a chamar `/api/cron` depois da quota SES resetar à meia-noite UTC. **Se o cron parar, os envios ficam presos** — mas isso deixou de ser invisível: ver o pulso do agendador na secção 4.
- **Cron / agendamento** — `/api/cron` (→ `campaigns?action=process-scheduled`) e `/api/cron/import` (→ `contacts?action=import_process`) são chamados por um agendador **externo** (não há cron nativo da Vercel configurado neste projecto). `/api/cron` exige `CRON_TRIGGER_SECRET` **quando essa variável está definida** (por cabeçalho `Authorization: Bearer …` ou por `?k=`, porque nem todos os agendadores enviam cabeçalhos); sem ela definida aceita chamadas anónimas e deixa um aviso no log, para um deploy não parar os envios antes de o agendador ser actualizado. `/api/cron/import` exige o header `CRON_SECRET`, que é uma variável **diferente** — sobrecarregar um segredo com dois fins foi parte do problema original. Se campanhas agendadas não saírem à hora certa, verificar primeiro se o serviço de cron externo está a chamar estes endpoints.
- **Rodapé legal** — montado em `lib/emailFooter.js` e acrescentado a todos os envios (envio real, envio de teste e versão web). Tem três partes: a área cinzenta com o disclaimer da marca ou global, a **frase legal** (destinatário, ano, sede e NIPC) e a linha de links (Política de privacidade | Versão web | Cancelar subscrição). A frase legal **e a linha de links** podem ser desligadas em conjunto **por campanha**, no ecrã de envio → cartão "Rodapé legal" (coluna `campaigns.no_legal_notice`, migração 052; por omissão FALSE, ou seja são enviadas). O disclaimer da área cinzenta não é afectado. **Risco assumido:** sem o link visível de cancelamento no corpo há mais probabilidade de os emails serem marcados como spam — o Gmail e o Yahoo pedem-no desde Fevereiro de 2024. O cabeçalho `List-Unsubscribe` continua a ser enviado em todos os casos (`lib/rawEmail.js`), por isso o botão de cancelamento desses clientes continua a funcionar.
- **Contactos de um ficheiro no envio** — ao carregar um ficheiro no passo dos destinatários, cada endereço é gravado em `contacts` (é assim que passa a ser destinatário) mas fica marcado `hidden=TRUE` (migração 053) e **não aparece na página de Contactos**. Deixa de estar marcado se entrar numa lista, por importação ou à mão. Nunca se marca um contacto que já existia. Não são apagados no fim do envio: `campaign_recipients.contact_id` é `ON DELETE CASCADE`, e apagá-los levava atrás o relatório da campanha (0 enviados, sem registo de erros) — chegou a acontecer, e os dois motores de envio comportavam-se de forma diferente. Para ver os não listados na API: `GET /api/contacts?mostrar_ocultos=1`.
- **Ninguém cancelado recebe** — antes de cada lote, `bloquearCancelados` (em `lib/campanhas.js`, partilhada pelos dois motores de envio) marca como falhados os destinatários pendentes que estejam na tabela `suppression` (por email ou por domínio, gravado como `@dominio.pt`) **ou** cujo contacto tenha `status` em `unsubscribed`/`bounced`/`suppressed`/`complained`. As duas verificações são precisas: cancelar pelo link do email põe o endereço na supressão, mas mudar o estado à mão na aplicação não — e durante um tempo esse caso passava. Antes desta há duas barreiras anteriores: as listas só contribuem contactos `active` e não suprimidos (`initCampaignSend`), e os destinatários directos são filtrados pelas mesmas duas condições ao serem ligados à campanha (`add_direct_recipients`).
- **Supressão de domínio inteiro** — em Supressões é possível bloquear um domínio (`@dominio.pt`). Isso insere a linha em `suppression` **e** marca todos os contactos desse domínio com `status='suppressed'`. É a explicação típica para "importei N contactos válidos e só entrou metade": um único registo destes recusa todos os endereços do domínio, em todas as campanhas. Desde a correcção, **remover** uma supressão (email ou domínio) reactiva os contactos que estavam `suppressed` e já não estão cobertos por nenhuma entrada — nunca toca em quem cancelou (`unsubscribed`) ou foi devolvido (`bounced`). A resposta do `DELETE /api/suppression` traz `reactivados`.
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

## 4. Operação e entregabilidade

### 4.1 Saber que está tudo a andar

O ecrã **Estatísticas** abre com quatro indicadores no topo (`GET /api/campaigns?action=saude`). São só leitura e existem porque, antes deles, a única forma de saber que alguma coisa tinha parado era reparar que uma campanha não saiu.

| Indicador | Verde | Amarelo | Vermelho |
|---|---|---|---|
| **Agendador** | pulso com menos de 15 min | >15 min, ou campanhas agendadas por processar | >1 h sem pulso |
| **Fila** | nada por enviar, ou a enviar normalmente | 5 min sem uma tentativa | 10 min sem uma tentativa |
| **Rejeições** | <2% | ≥2% | ≥5% — limite da AWS |
| **Queixas de spam** | <0,05% | ≥0,05% | ≥0,1% — limite da AWS |

O **pulso** é uma linha em `cron_heartbeat` (migração 066) reescrita a cada invocação de `/api/cron`. Se marcar «nunca», ou se o agendador aparecer a vermelho:

1. Confirmar no serviço de agendamento externo que o job está activo e a apontar para `https://<domínio>/api/cron`.
2. Se `CRON_TRIGGER_SECRET` estiver definida na Vercel, confirmar que o agendador a envia — em `Authorization: Bearer <segredo>` ou em `?k=<segredo>`. Um segredo errado devolve 401 e o job parece correr bem do lado do agendador.
3. Chamar o endpoint à mão para ver a resposta. Depois disso o pulso deve ficar verde.

As taxas de rejeição e queixa contam **só as campanhas desta plataforma**; a AWS calcula as dela sobre o volume total da conta. Servem para apanhar uma campanha má a tempo — **o número que manda é o do painel de reputação do SES**.

### 4.2 Aquecimento de IP e tecto diário

Um domínio que passa de mil emails por mês para cem mil de um dia para o outro é tratado pelos grandes fornecedores como suspeito: o correio vai para spam ou é recusado em bloco, e recuperar reputação demora semanas. A prática é subir por degraus ao longo de 4 a 6 semanas.

`SES_LIMITE_DIARIO` dá a esse plano uma trava real. Aplica-se **por cima** da quota da AWS — toma-se sempre o menor dos dois — e atingi-lo **não é um erro**: os destinatários que não couberam voltam a `pending` e saem na invocação seguinte, pelo mesmo caminho da quota esgotada.

Um degrau plausível, a ajustar conforme o painel de reputação (só se sobe se as taxas estiverem verdes):

| Semana | `SES_LIMITE_DIARIO` |
|---|---|
| 1 | 5 000 |
| 2 | 15 000 |
| 3 | 40 000 |
| 4 | 80 000 |
| 5+ | remover a variável |

Sem a variável definida não há tecto nenhum além do da AWS — que é o comportamento de hoje.

### 4.3 Passos que só se fazem na consola da AWS

Nenhum destes é código. Estão aqui porque a entregabilidade depende deles e não se resolvem no repositório. Nenhum dos que ficam por fazer tem custo: são registos de DNS e configuração de identidades, não serviços facturados.

**Configuration set — decidido NÃO fazer.** Fica aqui a decisão e a razão, para não voltar a ser discutida do zero.

O que um configuration set acrescentaria é **atribuição das métricas do lado da AWS**. Não é preciso, porque essa informação já existe em dois sítios que não custam nada:

- o **painel de saúde** do ecrã de Estatísticas (secção 4.1), que calcula as taxas de rejeição e de queixa a partir da base de dados da própria plataforma;
- o **painel de reputação do SES**, que dá os números oficiais ao nível da conta.

Contra isso, um destino de eventos no CloudWatch tem custo recorrente: as métricas de um *event destination* são *custom metrics*, cobradas **por métrica e por mês**, e o número delas é o produto dos tipos de evento pelos valores distintos de cada dimensão. Com uma dimensão de alta cardinalidade como `campaign_id` cada campanha nova cria um conjunto de métricas novo — sete tipos de evento vezes cem campanhas são setecentas métricas cobradas todos os meses, e a crescer com o catálogo.

**O código continua preparado.** `SES_CONFIGURATION_SET` existe em `lib/ses.js` e aplica-se ao envio de campanha e ao de teste. Enquanto a variável não estiver definida, o campo não é incluído no pedido ao SES e não há diferença nenhuma — não há nada a remover, e a opção fica aberta sem custo.

Se um dia a decisão mudar, o apêndice 4.6 tem os passos e as armadilhas.

**Autenticação: o que está montado, e onde é frágil.** O `_dmarc.caetano.pt` é:

```
v=DMARC1; p=reject; adkim=s; aspf=s; fo=1; sp=none; rua=mailto:dmarc@rigorcg.pt
```

É a política mais estrita possível, e o que dela decorre não é óbvio:

- **`p=reject`** — correio que não alinhe é **recusado**, não entregue em spam. Não há meio-termo nem aviso.
- **`adkim=s` / `aspf=s`** — alinhamento **estrito**: o domínio não pode ser um subdomínio do `From:`, tem de ser **exactamente igual**.
- **`sp=none`** — subdomínios estão isentos. Enviar de `@emkt.caetano.pt` não seria abrangido por esta política.
- Os relatórios vão para `dmarc@rigorcg.pt` — **quem gere o DNS é externo**. Qualquer alteração aos registos passa por lá.

O DKIM de `caetano.pt` foi confirmado como **`Successful`** no SES (Setembro de 2026). É ele que mantém o DMARC de pé, já que o `Return-Path` do SES aponta para `amazonses.com` e por isso o SPF **não** alinha em modo estrito.

> **O risco que isto cria:** o DKIM é o **único** ponto de apoio. Se esses registos forem removidos ou expirarem — numa limpeza de DNS, numa rotação de chaves do SES, numa migração —, com `p=reject` **todos os emails passam a ser recusados de imediato**, campanhas e magic links de login incluídos. E como não há palavra-passe de recurso, ninguém entra na plataforma. Vale a pena confirmar com quem gere o DNS que os CNAME de DKIM do SES para `caetano.pt` estão lá e assinalados como não removíveis.

**MAIL FROM próprio — não vale a pena neste domínio.** A ideia seria alinhar também o SPF. Mas com `aspf=s`, o alinhamento estrito exige que o domínio do `Return-Path` seja **exactamente** `caetano.pt`; um `mail.caetano.pt` **não alinha**, e é precisamente um subdomínio que a AWS pede para o custom MAIL FROM. Daria um `Return-Path` mais apresentável nos cabeçalhos e nada mais — não acrescenta um segundo caminho de alinhamento, que era a única razão para o fazer. Só passaria a valer se a política fosse relaxada para `aspf=r`, e isso é uma decisão de quem gere o DMARC, não desta plataforma.

**Separar transaccional de marketing.** Hoje os magic links de login saem pelo mesmo domínio e reputação das campanhas. Uma campanha com muitas queixas pode impedir as pessoas de entrar na plataforma — e como não há login por palavra-passe, isso tranca toda a gente ao mesmo tempo. A separação faz-se com um subdomínio e uma identidade SES próprios para o transaccional (ex.: `login.caetano.pt`), e depois `MAGIC_LINK_FROM` a apontar para lá. **Isto ainda não está feito.**

Nota sobre a ordem das coisas: isto é seguro contra uma **degradação de reputação**, que é gradual e dá sinais no painel de saúde. Não protege do modo de falha descrito acima — se o DKIM de `caetano.pt` cair, um subdomínio novo teria de ter o seu próprio DKIM montado para escapar, e `sp=none` só o isenta do `p=reject`, não o faz chegar. Confirmar o DKIM vem primeiro, e é de graça.

### 4.4 Teste de carga

`scripts/carga.js` mede os quatro caminhos que decidem o tecto: arranque do envio, reclamação de lote, paginação de contactos e agregação do painel.

```
CARGA_DATABASE_URL=postgres://…  node scripts/carga.js --contactos 100000
CARGA_DATABASE_URL=postgres://…  node scripts/carga.js --limpar
```

Usa uma variável própria, e não `DATABASE_URL`, precisamente para não poder apontar para produção por distracção; um URL que se pareça com o do Supabase é recusado. Semeia centenas de milhares de linhas e **não as apaga sozinho** — o `--limpar` é um passo à parte. Correr contra uma cópia descartável.

### 4.5 O que continua por fazer

**Adiado por decisão, não por esquecimento** (Setembro de 2026). Os dois pontos abaixo são portas a fechar, não avarias: o sistema envia correctamente sem eles. Ficam registados com a consequência de continuarem por fazer, para a decisão poder ser revista com conhecimento de causa.

- **`CRON_TRIGGER_SECRET` não está definida** → o `/api/cron` aceita chamadas de qualquer origem. Não permite enviar nada que não esteja já agendado, mas permite a um estranho consumir invocações da Vercel e acelerar o gasto da quota do SES. O código escreve `SECURITY: /api/cron sem CRON_TRIGGER_SECRET` no log a cada passagem — esse aviso vai continuar a aparecer, e é esperado.

  Quando se avançar, **a ordem importa**: primeiro acrescentar `?k=<segredo>` (ou o cabeçalho `Authorization: Bearer <segredo>`) no agendador externo — enquanto a variável não existe, o parâmetro é ignorado — e **só depois** criar a variável na Vercel e redesdobrar. Pela ordem inversa, os envios agendados param até alguém reparar.

- **`SNS_TOPIC_ARNS` não está definida** → o webhook aceita qualquer mensagem validamente assinada pelo SNS, sem confirmar de que conta AWS veio. Alguém com conta própria poderia fabricar eventos de bounce ou de queixa para endereços à escolha e vê-los entrar na tabela de supressão, impedindo envios para clientes reais. O pior cenário já está fechado — o código recusa confirmar subscrições de tópicos não autorizados —, fica só o caso de mensagens forjadas à mão.

  O valor a usar é impresso pelo próprio código quando chega um evento: procurar nos logs da função `api/track` a linha `webhook SNS aceite sem lista de tópicos — define SNS_TOPIC_ARNS=…`. Aqui não há ordem crítica: o tópico já existe e definir a variável apenas restringe o que já acontece.

**Por fazer, sem decisão tomada:**

- **Limitação por ISP** (ritmos diferentes para Gmail, Outlook, Sapo). Exigiria reordenar os destinatários por domínio dentro do motor de envio — a parte com mais risco de todo o sistema. Não foi feito.
- **Alertas activos.** O diagnóstico existe mas é preciso alguém abrir o ecrã. Um alerta por email ou Slack quando o pulso envelhece implicaria um endpoint novo, e a Vercel já está no limite de 12 funções.

### 4.6 Apêndice — configuration set, se a decisão mudar

Os passos ficam registados para não terem de ser redescobertos. A decisão em vigor é a da secção 4.3: **não fazer**.

Pela consola: SES → Configuration sets → *Create set*, ligar *Reputation metrics*, e **parar aí** — não adicionar destino de eventos. Depois definir `SES_CONFIGURATION_SET` na Vercel com o nome exacto, **redesdobrar** (uma variável nova só entra num deploy novo) e fazer um **envio de teste pela plataforma** antes de qualquer campanha.

No **AWS CloudShell**:

```bash
REGIAO=eu-west-1            # tem de ser igual a AWS_REGION na Vercel
CONJUNTO=emkt-eventos

aws sesv2 create-configuration-set \
  --region "$REGIAO" \
  --configuration-set-name "$CONJUNTO" \
  --reputation-options ReputationMetricsEnabled=true

aws sesv2 get-configuration-set --region "$REGIAO" --configuration-set-name "$CONJUNTO"
```

Desfazer: apagar a variável na Vercel e redesdobrar — só isso já repõe tudo. Apagar o conjunto na AWS é opcional:

```bash
aws sesv2 delete-configuration-set --region eu-west-1 --configuration-set-name emkt-eventos
```

As armadilhas, se alguma vez se acrescentar um destino de eventos:

- **Bounces e queixas já chegam** por notificações da identidade verificada. Publicá-los também pelo configuration set gera duas mensagens SNS por evento real, com `MessageId` diferentes — a idempotência da migração 063 é por `sns_message_id` e **não** as apanha. Um bounce transitório passaria a consumir dois `retry_count` em vez de um, e à segunda ocorrência punha o destinatário em `failed`. É exactamente a avaria que a 063 veio corrigir.
- **Open e click** têm de ficar **desligados** no configuration set. A plataforma tem o seu próprio pixel e o seu próprio redireccionador; com os do SES ligados, o SES reescreve os links (passam a apontar para `…awstrack.me`) por cima da reescrita que já foi feita, o que acrescenta um salto, tira a marca do endereço e baralha o relatório.
- Os restantes eventos (`Delivery`, `Reject`, `Rendering Failure`, `DeliveryDelay`) **não são tratados pelo webhook** — caem no fim da cadeia de `if` e devolvem 200 sem fazer nada. Mandá-los por SNS não traria informação nenhuma; em CloudWatch tornam-se métricas e alarmes.

> **Atenção:** um nome que não exista na conta faz o SES rejeitar *todos* os envios (`ConfigurationSetDoesNotExistException`). É por isso que a variável não tem valor por omissão, e é por isso que o envio de teste passa pelo mesmo caminho — para a configuração errada aparecer num teste e não numa campanha.

Pela consola: SES → Configuration sets → *Create set*, ligar *Reputation metrics*, e **parar aí**. Não adicionar destino de eventos.

Ou, no **AWS CloudShell** (canto superior direito da consola, já autenticado):

```bash
REGIAO=eu-west-1            # tem de ser igual a AWS_REGION na Vercel
CONJUNTO=emkt-eventos

aws sesv2 create-configuration-set \
  --region "$REGIAO" \
  --configuration-set-name "$CONJUNTO" \
  --reputation-options ReputationMetricsEnabled=true

# Confirmar
aws sesv2 get-configuration-set --region "$REGIAO" --configuration-set-name "$CONJUNTO"
```

Sem destino de eventos não há *custom metrics*, não há eventos novos a chegar ao webhook, e o SES **não** reescreve os links — porque é a subscrição de `OPEN`/`CLICK` num destino que o leva a fazê-lo, e aqui não há destino nenhum.

Se mais tarde quiser gráficos e alarmes, acrescente um destino CloudWatch **sem `DimensionConfigurations`**, para o número de métricas não crescer com o catálogo de campanhas:

```bash
aws sesv2 create-configuration-set-event-destination \
  --region "$REGIAO" --configuration-set-name "$CONJUNTO" \
  --event-destination-name cloudwatch \
  --event-destination '{
    "Enabled": true,
    "MatchingEventTypes": ["SEND","DELIVERY","BOUNCE","COMPLAINT","REJECT","RENDERING_FAILURE","DELIVERY_DELAY"],
    "CloudWatchDestination": { "DimensionConfigurations": [] }
  }'
```

Desfazer (se tiver criado um destino, apagá-lo primeiro — um conjunto com destinos não se apaga):

```bash
aws sesv2 delete-configuration-set-event-destination \
  --region "$REGIAO" --configuration-set-name "$CONJUNTO" --event-destination-name cloudwatch
aws sesv2 delete-configuration-set --region "$REGIAO" --configuration-set-name "$CONJUNTO"
```

> **Nota de código:** `api/track.js` tem ramos para os eventos `open` e `click` do SES que lêem os cabeçalhos `X-Campaign-Id`/`X-Contact-Id`. Esses cabeçalhos **nunca são enviados** (`lib/rawEmail.js` só acrescenta os de `List-Unsubscribe`), por isso os ramos não fazem nada. São código morto, não uma funcionalidade a activar.

> **Atenção:** um nome que não exista na conta faz o SES rejeitar *todos* os envios (`ConfigurationSetDoesNotExistException`). É por isso que a variável não tem valor por omissão, e é por isso que o envio de teste passa pelo mesmo caminho — para a configuração errada aparecer num teste e não numa campanha.

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
