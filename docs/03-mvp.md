# 03 — Definição de MVP

## Caetano PrimeMail — MVP e Roadmap

---

## 3.1 Filosofia do MVP

O MVP do Caetano PrimeMail deve ser **simples de usar mas tecnicamente robusto**. Não é um protótipo descartável — é a fundação sobre a qual a V2 e V3 serão construídas. Por isso, as decisões de arquitetura do MVP têm de ser corretas desde o início, mesmo que algumas funcionalidades sejam adicionadas depois.

> **Princípio:** Construir menos funcionalidades, mas construí-las bem. A base técnica do MVP não pode criar dívida técnica para o futuro.

---

## 3.2 MVP Obrigatório — O Que Entra na V1

### Autenticação e Utilizadores ✅
- [x] Login seguro (email + password com bcrypt/argon2)
- [x] Logout com invalidação de sessão
- [x] Recuperação de password por email
- [x] Verificação de email após registo
- [x] Gestão de sessão com expiração
- [x] Perfis de utilizador (nome, email, password)
- [x] Criação de utilizadores por convite (admin envia convite)
- [x] Papéis: `super_admin`, `group_admin`, `brand_admin`, `marketing_manager`, `marketing_coordinator`, `analyst`
- [x] Permissões por marca (utilizador + marca + papel)
- [x] Rate limiting no login (proteção brute force)
- [x] Audit logs de autenticação

### Gestão de Marcas ✅
- [x] CRUD de marcas (nome, slug, logótipo, cor primária, email remetente)
- [x] Dropdown de seleção de marca no topo da aplicação
- [x] Mudança de contexto ativo de marca (sem reload de página)
- [x] Persistência da marca ativa na sessão
- [x] Restrição de acesso por marca (middleware)
- [x] Associação utilizador ↔ marca com papel

### Gestão de Contactos ✅
- [x] Criar e listar listas de contactos por marca
- [x] Adicionar contacto manualmente (nome, email, campos básicos)
- [x] Importação de CSV/Excel (assíncrona, chunked, com progresso)
- [x] Mapeamento de colunas na importação
- [x] Validação de email na importação
- [x] Deduplicação básica (por email dentro da mesma lista)
- [x] Histórico de importações com estado e resumo
- [x] Unsubscribes: link em cada email, landing page de confirmação, bloqueio automático
- [x] Suppression list por marca (adição manual + automática via unsubscribe/bounce)
- [x] Paginação de contactos (cursor-based ou offset com limite)
- [x] Associação de contactos à marca ativa

### Campanhas ✅
- [x] Criar campanha (nome, assunto, preview text, remetente)
- [x] Editor HTML básico (sem drag-and-drop no MVP — pode ser simplificado)
- [x] Seleção de lista(s) destinatárias (da marca ativa)
- [x] Envio de test email
- [x] Agendamento de campanha (data/hora)
- [x] Envio imediato com confirmação
- [x] Estados da campanha: draft, scheduled, sending, sent, failed
- [x] Associação obrigatória da campanha à marca ativa
- [x] Processamento de envio assíncrono (queue + workers)
- [x] Merge tags básicos: `{{first_name}}`, `{{email}}`, `{{unsubscribe_url}}`

### Templates ✅
- [x] Criar/editar templates HTML por marca
- [x] Usar template ao criar campanha
- [x] Templates partilhados (grupo) vs. exclusivos por marca

### Relatórios Básicos ✅
- [x] Métricas por campanha: entregues, aberturas, cliques, bounces, unsubscribes
- [x] Dashboard por marca com KPIs recentes
- [x] Lista de campanhas com métricas em tabela

### Infraestrutura e Base Técnica ✅
- [x] Backend PHP 8.3 + Laravel 11
- [x] MySQL 8.0 como base de dados principal
- [x] Redis para filas (queues) e cache
- [x] Laravel Horizon para monitorização de filas
- [x] S3-compatible para armazenamento de ficheiros importados
- [x] Docker para desenvolvimento local
- [x] Variáveis de ambiente via `.env`
- [x] Índices compostos com `brand_id` desde o início
- [x] Logging estruturado (Laravel Log + arquivo)
- [x] Tratamento global de erros e exceções

---

## 3.3 O Que Fica FORA do MVP

As funcionalidades abaixo são intencionalmente excluídas do MVP para manter o foco e velocidade de entrega. Estão todas mapeadas para V2 ou V3.

### Excluído do MVP — V2 / Roadmap

| Funcionalidade | Prioridade V2 | Justificação |
|----------------|---------------|--------------|
| Editor drag-and-drop (Unlayer/Stripo) | Alta | Complexidade de integração. MVP usa HTML editor |
| Segmentos dinâmicos com regras | Alta | Complexidade de UI e query builder. V2 com builder visual |
| 2FA (Two-Factor Authentication) | Alta | Segurança adicional importante. V2 com TOTP |
| Campos personalizados dinâmicos | Média | Complexidade de schema. V2 com campos extra |
| Tags em contactos | Média | Útil mas não bloqueante no MVP |
| Automações (drip campaigns, workflows) | Alta | Feature complexa — roadmap dedicado |
| A/B Testing de campanhas | Média | Nice-to-have mas não essencial no início |
| Mapa de calor de cliques | Baixa | Feature analítica avançada |
| Relatórios multi-marca agregados (admin) | Média | V2 — dashboard de grupo |
| Exportação de relatórios (CSV/PDF) | Média | V2 — útil mas não bloqueante |
| Webhooks outbound | Baixa | Para integrações externas — V3 |
| API pública para integrações | Média | V2 com autenticação por API key |
| SSO / SAML / OAuth (Microsoft AD) | Média | Relevante para ambiente corporativo — V2 |
| Gestão avançada de bounces (categorização) | Média | MVP trata hard/soft de forma básica |
| Versionamento de templates | Baixa | Complexidade adicional — V2 |
| Internacionalização (i18n) | Baixa | PT-PT apenas no MVP |
| Dark mode UI | Baixa | UX enhancement — V2 |
| Mobile app | Baixa | Web-first no MVP |
| Integração CRM (Salesforce, HubSpot) | Baixa | V3 — requer API pública estável |
| Notificações push / Slack | Baixa | V2 para alertas de campanha enviada |
| Gestão avançada de consentimento (preference center) | Média | V2 — landing page de preferências completa |
| Relatórios de entregabilidade (blacklists, SPF/DKIM check) | Média | V2 — monitorização de saúde de envio |

---

## 3.4 V2 — Otimização e Funcionalidades Adicionais

**Timeline estimada: 3–6 meses após lançamento do MVP**

### Funcionalidades V2
- Editor visual drag-and-drop (Unlayer ou Stripo integration)
- Segmentos dinâmicos com query builder visual
- 2FA (TOTP)
- Campos personalizados dinâmicos por marca
- Tags em contactos + filtragem por tag
- Dashboard de grupo multi-marca para admins
- Exportação de relatórios (CSV, Excel, PDF)
- API pública com autenticação por API key
- Notificações internas (campanha enviada, importação completa)
- Integração SSO (Microsoft Azure AD / SAML 2.0)
- Preference center para gestão de consentimento pelo destinatário
- Relatórios de entregabilidade (análise de bounce rates, alertas)
- Versionamento simples de templates
- Melhorias de UX baseadas em feedback real da V1

---

## 3.5 V3 — Escala e Funcionalidades Avançadas

**Timeline estimada: 9–18 meses após MVP**

### Funcionalidades V3
- Automações e workflows (drip campaigns, welcome series, triggers por comportamento)
- A/B Testing (assunto, conteúdo, hora de envio)
- Integrações CRM (Salesforce, HubSpot, DealerSocket)
- Mapa de calor de cliques
- Análise preditiva de open rates
- Segmentação por comportamento avançado (RFM - Recency, Frequency, Monetary)
- Webhook outbound para eventos (abertura, clique, bounce, unsubscribe)
- Multi-tenant isolamento para operação como SaaS externo (se estratégia mudar)
- API GraphQL (complementar ao REST)
- Internacionalização (múltiplos idiomas)
- App mobile nativa (iOS / Android)

---

## 3.6 Critérios de Aceitação do MVP

O MVP está completo quando:

1. Um utilizador consegue fazer login de forma segura ✓
2. Um administrador consegue criar uma marca e associar utilizadores ✓
3. Um utilizador consegue selecionar uma marca ativa no dropdown ✓
4. Um utilizador consegue criar uma lista e importar 100.000 contactos sem bloquear a interface ✓
5. A importação processa em background e mostra progresso ao utilizador ✓
6. Um utilizador consegue criar uma campanha, escolher uma lista e agendar o envio ✓
7. A campanha é enviada pela fila de jobs sem bloquear outros utilizadores ✓
8. Após envio, as métricas de abertura e clique são rastreadas e mostradas ✓
9. Um unsubscribe via link no email é processado automaticamente e o contacto não recebe mais emails ✓
10. Um utilizador de uma marca não consegue aceder aos dados de outra marca ✓

---

*Próximo: [04 — Arquitetura Técnica](04-technical-architecture.md)*
