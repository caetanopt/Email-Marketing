# 16 — Requisitos Não Funcionais

## Caetano PrimeMail — RNF: Performance, Segurança, Disponibilidade e Mais

---

## Performance

**RNF-P01 — Tempo de resposta para ações normais**
Todas as páginas e ações normais (carregar dashboard, listar campanhas, abrir campanha) devem responder em menos de **300ms** (p95) em condições normais de carga.

**RNF-P02 — Tempo de resposta para listagens grandes**
Listagens de contactos com paginação (até 50 por página) devem responder em menos de **500ms** (p95), independentemente do total de contactos na lista.

**RNF-P03 — Upload de ficheiro CSV**
O upload de um ficheiro CSV de até 100MB deve completar em menos de **30 segundos** numa ligação de 50Mbps. O processamento posterior é assíncrono.

**RNF-P04 — Throughput de importação**
O sistema deve ser capaz de processar pelo menos **50.000 contactos por minuto** por worker de importação em condições normais.

**RNF-P05 — Throughput de envio de campanha**
O sistema deve ser capaz de enviar pelo menos **10.000 emails por minuto** com 2 workers de envio ativos (limitado pelo provider de email externo).

**RNF-P06 — Múltiplos utilizadores simultâneos**
A plataforma deve suportar pelo menos **50 utilizadores simultâneos** sem degradação de performance para operações normais.

**RNF-P07 — Degradação com volume de dados**
O p95 de tempo de resposta para listagens não deve aumentar mais de **20%** quando o total de contactos da base de dados duplicar. Garantido por índices compostos e paginação cursor-based.

**RNF-P08 — Isolamento de carga entre operações**
Importações pesadas em curso não devem degradar o tempo de resposta das ações de utilizador em mais de **50ms**.

---

## Segurança

**RNF-S01 — Autenticação obrigatória**
Nenhum endpoint da aplicação (exceto login, forgot-password, tracking de email e webhooks) deve ser acessível sem autenticação válida.

**RNF-S02 — Hash de passwords**
Todas as passwords devem ser armazenadas com Argon2id com parâmetros mínimos: memory=65536, threads=2, time=4.

**RNF-S03 — Rate limiting no login**
Após 5 tentativas de login falhadas com o mesmo email num período de 15 minutos, o acesso deve ser bloqueado por 15 minutos.

**RNF-S04 — Proteção CSRF**
Todos os pedidos POST/PUT/PATCH/DELETE devem incluir um token CSRF válido. Exceção: webhooks (protegidos por assinatura HMAC).

**RNF-S05 — Isolamento de dados por marca**
É absolutamente impossível para um utilizador aceder a dados de uma marca à qual não tem acesso autorizado, mesmo com manipulação de parâmetros HTTP.

**RNF-S06 — Headers HTTP de segurança**
Todos os responses devem incluir os headers: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Content-Security-Policy`.

**RNF-S07 — TLS obrigatório**
Toda a comunicação cliente-servidor deve ser feita sobre HTTPS com TLS 1.2 ou superior. HTTP deve redirecionar para HTTPS.

**RNF-S08 — Sessões seguras**
Cookies de sessão devem ter os atributos: `HttpOnly`, `Secure`, `SameSite=Lax`. O conteúdo da sessão deve ser encriptado.

**RNF-S09 — Ficheiros de upload**
Ficheiros importados nunca devem ser servidos publicamente. O acesso deve ser via URL assinada temporária (máx. 1 hora).

**RNF-S10 — Dados sensíveis em logs**
Logs de aplicação não devem conter passwords, tokens, dados pessoais completos ou números de cartão. PII limitado a identificadores.

**RNF-S11 — SQL Injection**
Nenhum input do utilizador deve ser interpolado diretamente em queries SQL. Apenas Eloquent/Query Builder com bindings.

**RNF-S12 — XSS**
Conteúdo HTML de campanhas deve ser sanitizado com HTMLPurifier antes de ser armazenado. Output em Blade deve usar `{{ }}` (escapado) por defeito.

---

## Disponibilidade e Fiabilidade

**RNF-D01 — Disponibilidade**
A plataforma deve ter uma disponibilidade mínima de **99.5%** (uptime) medida mensalmente, excluindo janelas de manutenção planeadas comunicadas com 24h de antecedência.

**RNF-D02 — Recuperação de falha**
RTO (Recovery Time Objective): menos de 4 horas após falha crítica.
RPO (Recovery Point Objective): menos de 1 hora de perda de dados.

**RNF-D03 — Jobs de fila**
Jobs falhados devem ser retentados automaticamente até 3 vezes com backoff exponencial. Após 3 falhas, o job deve ir para dead letter queue e gerar alerta.

**RNF-D04 — Falha de importação parcial**
Se um chunk de importação falhar, os outros chunks devem continuar a processar. A importação não deve falhar completamente por causa de um chunk.

**RNF-D05 — Backups automáticos**
Backups da base de dados devem ser realizados a cada hora (incremental) e diariamente (full). Backups devem ser testados mensalmente.

---

## Escalabilidade

**RNF-E01 — Escala horizontal de workers**
A camada de workers de fila deve poder escalar horizontalmente adicionando instâncias sem alterações de código.

**RNF-E02 — Volume de contactos**
A plataforma deve suportar pelo menos **5 milhões de contactos** no total sem degradação de performance, com os índices e particionamento corretos.

**RNF-E03 — Volume de eventos de email**
A tabela `email_events` deve suportar pelo menos **500 milhões de eventos** através de particionamento por data, com queries por campanha em menos de 2 segundos.

**RNF-E04 — Número de marcas**
O sistema deve suportar pelo menos **50 marcas ativas** sem impacto de performance, graças ao isolamento por `brand_id` e índices compostos.

---

## Auditoria e Conformidade

**RNF-A01 — Audit log obrigatório**
Todas as ações críticas (login, logout, criação/envio/cancelamento de campanha, importação, gestão de utilizadores, reset de password, pedidos RGPD) devem ser registadas de forma imutável no audit log.

**RNF-A02 — Imutabilidade do audit log**
Registos no audit log não podem ser atualizados ou apagados, nem por administradores. Apenas INSERT é permitido.

**RNF-A03 — Retenção de audit logs**
Audit logs devem ser retidos por um mínimo de 5 anos para conformidade com requisitos legais portugueses.

**RNF-A04 — Rastreabilidade de unsubscribes**
Todos os unsubscribes devem ser rastreados com timestamp, source, IP (quando aplicável) e referência à campanha que gerou o unsubscribe.

---

## Privacidade e RGPD

**RNF-PR01 — Consentimento rastreável**
O sistema deve registar a fonte e data de consentimento de cada contacto por marca. Sem consentimento registado, o contacto é tratado como `unknown` e pode ser excluído de campanhas a critério.

**RNF-PR02 — Direito ao esquecimento**
O sistema deve suportar a anonimização de dados pessoais de um contacto (primeiro nome, apelido, telefone, empresa) mantendo o hash do email para garantir que não volta a receber comunicações.

**RNF-PR03 — Portabilidade de dados**
O sistema deve permitir a exportação dos dados de um contacto em formato CSV legível.

**RNF-PR04 — Minimização de dados**
Só devem ser recolhidos e armazenados dados estritamente necessários para o funcionamento da plataforma.

**RNF-PR05 — Retenção automática**
Ficheiros de importação devem ser automaticamente eliminados do S3 após 30 dias do processamento completo.

---

## Manutenibilidade

**RNF-M01 — Cobertura de testes**
A cobertura de testes unitários deve ser mínimo de 80% em Actions, Services e lógica de negócio. Testes de segurança (isolamento de marca, permissões) devem cobrir 100% dos boundaries críticos.

**RNF-M02 — Qualidade de código**
O código deve passar no PHP CS Fixer (PSR-12) e Larastan (PHPStan nível 5 mínimo) sem erros.

**RNF-M03 — Documentação de API**
Para a V2, todos os endpoints da API pública devem ter documentação OpenAPI/Swagger actualizada.

**RNF-M04 — Migrations sem rollback destrutivo**
Nunca deve existir uma migration que apague dados sem criar uma migration de rollback segura. Alterações destrutivas devem ser feitas em múltiplos passos.

---

## Isolamento Lógico por Marca

**RNF-ISO01 — Global Scope obrigatório**
Todos os models com `brand_id` devem ter o `BrandScope` global ativo. Nenhuma query deve retornar dados de múltiplas marcas sem uso explícito de `withoutGlobalScope`.

**RNF-ISO02 — Contexto de sessão como source of truth**
O `brand_id` usado em todas as queries deve vir da sessão server-side (`session('active_brand_id')`), nunca de parâmetros HTTP ou body do request.

**RNF-ISO03 — Criação de entidades sempre na marca ativa**
Qualquer nova entidade criada (campanha, lista, contacto, template) deve ser automaticamente associada à marca ativa da sessão, sem possibilidade de o utilizador especificar outro `brand_id`.

**RNF-ISO04 — Verificação de acesso em leitura e escrita**
O isolamento de marca deve ser verificado tanto em operações de leitura (listagens, visualização) como de escrita (criação, edição, eliminação). Não é suficiente filtrar na listagem se a edição não verificar o acesso.
