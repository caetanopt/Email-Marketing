# 17 — Ordem de Desenvolvimento Recomendada

## Caetano PrimeMail — Sequência de Implementação Sem Dívida Técnica

---

## Princípio da Ordem

A sequência de desenvolvimento deve respeitar estas regras:

1. **Fundação antes de funcionalidade** — base técnica correta antes de features visíveis
2. **Segurança antes de conteúdo** — auth e permissões antes de CRUD de campanhas
3. **Esquema de dados antes de código** — migrations e índices corretos antes do primeiro insert
4. **Infraestrutura assíncrona antes de importações** — filas e workers antes de implementar upload
5. **Testes de segurança acompanham o desenvolvimento** — não são uma fase separada no final

---

## Fase 0 — Fundação Técnica (Semanas 1–2)

Esta fase não produz nenhuma funcionalidade visível para o utilizador, mas é a fundação de tudo o que vem depois. **Não avançar para a Fase 1 sem esta fase completa.**

### 0.1 Setup do Projeto

1. Criar projeto Laravel 11 com PHP 8.3
2. Configurar Docker Compose (PHP-FPM, Nginx, MySQL, Redis, MinIO, Mailpit, Horizon)
3. Configurar CI/CD (GitHub Actions: `php artisan test`, Laravel Pint, PHPStan)
4. Definir `.env.example` documentado com todos os valores necessários
5. Configurar logging estruturado (JSON logs)
6. Configurar Sentry para rastreamento de erros

### 0.2 Schema de Base de Dados

**Criar TODAS as migrations com índices corretos ANTES de qualquer código:**

1. `create_users_table` + índices
2. `create_roles_table` + `create_permissions_table` + `create_role_permissions_table`
3. `create_brands_table` + índices
4. `create_user_brand_roles_table` + índices compostos
5. `create_contact_lists_table` + índice `(brand_id, status)`
6. `create_contacts_table` + índices `(email)`, `(email_hash)`
7. `create_contact_list_members_table` + índices compostos incluindo `brand_id`
8. `create_contact_brand_relations_table` + índices
9. `create_imports_table` + índices
10. `create_campaigns_table` + índices compostos `(brand_id, status)`
11. `create_campaign_lists_table`
12. `create_campaign_recipients_table` + particionamento por `campaign_id`
13. `create_templates_table` + índices
14. `create_email_events_table` + particionamento por data
15. `create_unsubscribes_table` + índice `UNIQUE (brand_id, email)`
16. `create_suppression_list_table` + índice `UNIQUE (brand_id, email_hash)`
17. `create_login_sessions_table`
18. `create_audit_logs_table` + particionamento por data

**Por que migrations primeiro?**
Uma vez que há dados em produção, alterar o schema é complexo, perigoso e pode causar downtime. Acertar o schema antes é crucial.

### 0.3 Models e Global Scope

1. Criar todos os Models com relações Eloquent definidas
2. Criar e testar `BrandScope` em todos os models com `brand_id`
3. **Criar testes de isolamento de marca** — antes de qualquer funcionalidade

```
TESTE CRÍTICO: model->all() com active_brand_id na sessão só retorna dados dessa marca.
```

### 0.4 Sistema de Autorização

1. Criar seeds de papéis e permissões
2. Criar método `User::hasPermissionForBrand($permission, $brandId)`
3. Criar todas as Policies (CampaignPolicy, ContactListPolicy, etc.) — podem estar vazias mas a estrutura deve existir
4. Criar Middleware: `EnsureActiveBrand`, `BrandAccessMiddleware`, `CheckBrandPermission`
5. Definir estrutura de rotas protegidas

### 0.5 Configuração de Filas

1. Configurar Laravel Horizon com as filas definidas (`critical`, `high`, `default`, `imports`, `reports`, `cleanup`)
2. Testar que jobs são processados corretamente
3. Configurar dead letter queue e alertas de job falhado

### 0.6 Sistema de Audit Log

1. Criar `AuditLog` model imutável
2. Criar trait `Auditable` para facilitar registo de eventos
3. Testar que registos no audit log não podem ser editados

---

## Fase 1 — Autenticação (Semanas 3–4)

**Dependência:** Fase 0 completa.

### Sequência

1. `LoginController` + `LoginRequest` com rate limiting
2. Configurar Argon2id para hash de passwords
3. `LogoutController` com invalidação de sessão e audit log
4. `ForgotPasswordController` + `ResetPasswordController`
5. Email de verificação (via `MustVerifyEmail` do Laravel)
6. Sistema de convite (admin cria utilizador → email de convite → utilizador define password)
7. Perfil do utilizador (ver/editar nome, email, password)
8. Endpoint de seleção de sessões ativas e revogação
9. **Testes de auth** (login, logout, rate limiting, reset)
10. **Testes de segurança** (brute force, token de uso único, expiração)

---

## Fase 2 — Marcas e Contexto (Semanas 5–6)

**Dependência:** Fase 1 completa.

### Sequência

1. CRUD de marcas (`super_admin` / `group_admin`)
2. Associação utilizador ↔ marca ↔ papel (`user_brand_roles`)
3. `BrandSwitchController` com validação de acesso
4. Persistência da marca ativa na sessão + `User.active_brand_id`
5. Dropdown de marcas no frontend (Vue + Pinia store)
6. Atualização visual do contexto ao trocar de marca (cor, nome, logótipo)
7. Dashboard por marca (estrutura base com métricas placeholder)
8. **Testes de isolamento** (utilizador A não acede a dados de marca B)

---

## Fase 3 — Gestão de Contactos (Semanas 7–9)

**Dependência:** Fase 2 completa (precisa do contexto de marca funcional).

### Sequência

1. CRUD de listas de contactos (por marca ativa)
2. Adição manual de contacto a uma lista
3. Sistema de suppression list (CRUD + verificação automática)
4. Unsubscribes: `UnsubscribeController` (endpoint público), landing page, processamento automático
5. Upload de ficheiro CSV/XLSX para S3 + validação de segurança
6. `ParseImportHeadersJob` + API de polling de headers
7. Interface de mapeamento de colunas (Vue)
8. `ProcessImportChunkJob` com deduplicação e registo de erros
9. `FinalizeImportJob` com geração de ficheiro de erros e atualização de counters
10. Polling de progresso no frontend
11. Histórico de importações
12. **Testes de importação** (deduplicação, erros, progresso, concorrência)
13. **Testes de supressão** (email suprimido não é importado, não recebe campanha)

---

## Fase 4 — Campanhas (Semanas 10–12)

**Dependência:** Fase 3 completa (precisa de listas e contactos funcionais).

### Sequência

1. CRUD de templates HTML por marca
2. Templates partilhados (grupo)
3. Criação de campanha (wizard passo 1: conteúdo + editor HTML)
4. Seleção de listas destinatárias (passo 2) com estimativa de destinatários
5. Preview e test email (passo 3)
6. Agendamento de campanha
7. Envio imediato com confirmação modal
8. `SendCampaignJob` — deduplicação, verificação de supressão, criação de `campaign_recipients`
9. `SendCampaignBatchJob` — envio em batches via provider
10. Webhook de bounce (`MailgunWebhookController` ou equivalente)
11. Processamento automático de bounces hard → suppression list
12. **Testes de envio** (estados, supressão, bounces, deduplicação de destinatários)

---

## Fase 5 — Tracking e Relatórios (Semanas 13–14)

**Dependência:** Fase 4 completa (precisa de campanhas enviadas).

### Sequência

1. Endpoint de tracking de abertura (pixel 1x1) com buffer Redis
2. Endpoint de tracking de clique (redirect) com buffer Redis
3. `FlushEmailEventsJob` (agendado a cada minuto)
4. Página de relatório por campanha (métricas básicas)
5. Dashboard com KPIs dos últimos 30 dias por marca
6. Cache de métricas no Redis com invalidação correcta
7. **Testes de tracking** (abertura, clique, buffer, flush)

---

## Fase 6 — Polimento e Lançamento (Semanas 15–16)

### Sequência

1. Revisão de segurança completa (checklist do [09 — Segurança](09-security.md))
2. Headers HTTP de segurança (CSP, HSTS, etc.)
3. Testes de performance (import 100k, envio 10k, 50 utilizadores simultâneos)
4. Setup de infraestrutura de produção
5. Configuração de backups automáticos e teste de restore
6. Configuração de monitorização (Sentry, Horizon, health check, alertas)
7. Documentação de utilizador básica
8. **Go-live checklist** completo
9. Lançamento

---

## Resumo Visual da Sequência

```
SEMANA:  1  2  3  4  5  6  7  8  9  10 11 12 13 14 15 16
         ─────────────────────────────────────────────────
Fase 0:  ████████
Fase 1:           ████████
Fase 2:                   ████████
Fase 3:                           █████████████
Fase 4:                                       ████████████
Fase 5:                                                  ████████
Fase 6:                                                          ████████
         ─────────────────────────────────────────────────
                                                                🚀 LAUNCH
```

---

## Regras Anti-Atalho

### Nunca fazer isto para "ir mais rápido"

| Atalho tentador | Por que é perigoso |
|----------------|-------------------|
| Criar migrations sem índices "para adicionar depois" | Adicionar índices em tabelas grandes em produção = downtime |
| Implementar envio de campanha de forma síncrona "para testar" | Cria expectativa errada e o refactor é custoso |
| Guardar brand_id do request sem validar | Vulnerabilidade de segurança grave — cross-brand access |
| Usar `Auth::user()->brand_id` em vez da sessão | Não existe um único brand_id por utilizador — tem muitos |
| Saltar testes de isolamento de marca "para depois" | Bugs de segurança descobertos tarde são muito mais caros |
| Começar o frontend antes da fundação de auth + marca estar sólida | O contexto de marca afeta TUDO no frontend — tem de estar estável |
| Não testar restore de backups | Descobrir que o backup não funciona durante um incidente |

---

*Fim da documentação principal do Caetano PrimeMail.*
*Ver [README.md](../README.md) para índice completo.*
