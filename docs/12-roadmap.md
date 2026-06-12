# 12 — Roadmap por Fases

## Caetano eMKT — Da Fundação à Escala

---

## Fase 1 — MVP (0–4 meses)

> **Objetivo:** Lançar uma plataforma funcional, segura e rápida que cubra os casos de uso essenciais de email marketing multi-marca.

### Semanas 1–2: Fundação Técnica

**Infraestrutura e Setup:**
- [x] Configuração do projeto Laravel 11 + PHP 8.3
- [x] Docker Compose para desenvolvimento local (PHP, MySQL, Redis, MinIO, Mailpit, Horizon)
- [ ] CI/CD básico (GitHub Actions: lint, testes, deploy)
- [x] Estrutura de pastas e padrões definidos (ver [11 — Organização do Código](11-api-code-organization.md))
- [x] Migrations base: todas as tabelas definidas com índices corretos (20 migrations)
- [x] Seeds: papéis, permissões, marcas iniciais, admin, templates
- [ ] `.env.example` documentado

**Base técnica:**
- [x] Global Scope de `brand_id` implementado e testado (`app/Scopes/BrandScope.php`)
- [x] BrandAccessMiddleware funcional (`BrandAccessMiddleware` + `EnsureActiveBrand`)
- [x] Sistema de auditoria (`AuditLog` model + migration)
- [ ] Trait de auditoria reutilizável (model existe, trait não implementada)
- [ ] Políticas de autorização base (`CampaignPolicy`, `ContactListPolicy`, etc.) — pasta `Policies/` não existe

---

### Semanas 3–4: Autenticação e Utilizadores

- [x] Login seguro (email + password + rate limiting via `LoginRequest`)
- [x] Rate limiting e bloqueio após 5 tentativas
- [x] Sessões Redis encriptadas
- [x] Logout com invalidação de sessão
- [ ] Recuperação de password por email — sem `ForgotPasswordController` / `ResetPasswordController`
- [ ] Verificação de email — sem `EmailVerificationController`
- [ ] Registo de utilizadores por convite — sem `InvitationController`
- [ ] CRUD de utilizadores (admin) — sem `UserController`
- [x] Papéis e permissões (6 papéis — `UserRole` enum + `RolesAndPermissionsSeeder`)
- [ ] Testes de autenticação e brute force — só `LoginTest.php` básico

---

### Semanas 5–6: Gestão de Marcas e Contexto

- [x] Associação utilizador ↔ marca ↔ papel (`UserBrandRole` model + migration)
- [x] Dropdown de seleção de marca no topbar (`BrandSelectorController`)
- [x] `BrandSwitchController` com validação de acesso
- [x] Persistência do contexto de marca na sessão
- [x] Dashboard por marca (`DashboardController`)
- [x] Testes de isolamento de marca (middleware funcional)
- [ ] CRUD completo de marcas por admin — `BrandSettingsController` gere apenas a marca ativa; criação/eliminação de marcas por `super_admin` não implementada

---

### Semanas 7–9: Gestão de Contactos e Importação

- [x] CRUD de listas de contactos por marca (`ContactListController`)
- [x] Adição manual de contacto (`ContactController` + `CreateContactAction`)
- [x] Upload de ficheiro CSV/XLSX para S3 (`ImportController`)
- [x] Validação de ficheiro (MIME, tamanho, conteúdo)
- [x] Interface de mapeamento de colunas (Vue — `Lists/` + `Contacts/`)
- [ ] `ParseImportHeadersJob` (assíncrono) — parsing de cabeçalhos feito de forma síncrona no controller
- [x] `ProcessImportChunkJob` (chunks assíncronos)
- [x] `FinalizeImportJob` com geração de ficheiro de erros
- [x] Polling de progresso em tempo real no frontend (`imports.progress` route)
- [x] Suppression list por marca (`SuppressionController`)
- [x] Unsubscribes: link, landing page, processamento automático (`TrackingController`)
- [x] Histórico de importações (`ImportController@index/show`)
- [ ] Testes de importação (deduplicação, erros, progresso)

---

### Semanas 10–12: Campanhas e Envio

- [x] Criação de campanha (`CampaignController` + `CreateCampaignAction`)
- [x] Editor HTML + MJML (`TemplateController` + `MjmlCompiler`)
- [x] Seleção de listas destinatárias da marca ativa
- [x] Merge tags básicos (`{{first_name}}`, `{{email}}`, `{{unsubscribe_url}}`)
- [x] Envio de test email (`SendTestEmailAction`)
- [x] Agendamento de campanha (`DispatchScheduledCampaigns` command)
- [x] Envio imediato com confirmação
- [x] `SendCampaignEmailsJob` + `BuildCampaignRecipientsJob` (assíncrono, chunks)
- [x] Estados de campanha (`CampaignStatus` enum: draft → scheduled → sending → sent/failed)
- [x] Processamento de bounces via webhook (`WebhookController` + `ProcessWebhookEventAction`)
- [x] Templates HTML/MJML por marca (`TemplateController`)
- [ ] Testes de envio e estados de campanha

---

### Semanas 13–14: Relatórios e Métricas

- [x] Tracking de aberturas (pixel 1×1 — `TrackingController@open`)
- [x] Tracking de cliques (redirect — `TrackingController@click`)
- [ ] `FlushEmailEventsJob` (flush periódico Redis → MySQL) — `EmailEvent` model e migration existem, job de flush não implementado
- [x] Página de relatório por campanha (`campaigns.report` route + `CampaignController@report`)
- [x] Dashboard com KPIs (`DashboardController` + `Dashboard.vue`)
- [x] Webhook de bounce do provider (`WebhookController`)
- [x] Atualização de status de contacto via bounce (`ProcessWebhookEventAction`)

---

### Semanas 15–16: Polimento, Segurança e Lançamento

- [ ] Revisão de segurança completa (checklist [09 — Segurança](09-security.md))
- [ ] Headers HTTP de segurança
- [ ] Teste de penetração básico (OWASP Top 10)
- [ ] Performance testing (import de 100k contactos, envio de 10k emails)
- [ ] Documentação de utilizador básica
- [ ] Setup de produção (Docker + cloud)
- [ ] Backups automáticos configurados e testados
- [ ] Monitorização (Sentry, Horizon, health check) — Horizon configurado; Sentry e health check em falta
- [ ] **Lançamento MVP**

---

## Progresso Fase 1 — Resumo

| Área | Feito | Em falta |
|---|---|---|
| Infraestrutura | Docker, migrations, seeds, BrandScope, Middleware | CI/CD, `.env.example`, Trait auditoria, Policies |
| Autenticação | Login, logout, sessões, rate limiting, papéis | Password recovery, verificação email, convites, UserController |
| Marcas | Seleção, switch, settings da marca ativa, isolamento | Admin CRUD completo de marcas |
| Contactos e Importação | CRUD, import async, progresso, suppression, unsubscribe | `ParseImportHeadersJob`, testes |
| Campanhas | CRUD, envio, agendamento, test email, bounces, templates MJML | Testes |
| Relatórios | Tracking open/click, dashboard, relatório por campanha | `FlushEmailEventsJob` |
| Segurança e Deploy | — | Security headers, pentest, produção, Sentry, backups |

---

## Fase 2 — Otimização (meses 5–8)

> **Objetivo:** Melhorar a experiência, adicionar funcionalidades pedidas com base no feedback real da V1, e preparar a plataforma para maior escala.

### Prioridade Alta (Fase 2A — meses 5–6)

**Editor Avançado:**
- [ ] Integração de editor drag-and-drop (Unlayer ou Stripo)
- [ ] Templates visuais com bloco de conteúdo
- [ ] Preview responsivo desktop/mobile melhorado

**Segmentos Dinâmicos:**
- [ ] Query builder visual para criação de segmentos
- [ ] Preview em tempo real do número de contactos do segmento
- [ ] Segmentos baseados em comportamento (abriu campanha X, clicou em Y)
- [ ] Uso de segmentos na seleção de destinatários de campanha

**Segurança (2FA):**
- [ ] Autenticação de dois fatores (TOTP — Google Authenticator)
- [ ] Códigos de backup
- [ ] Opção de obrigar 2FA para `brand_admin`+

### Prioridade Média (Fase 2B — meses 7–8)

**Campos Personalizados:**
- [ ] Criação de campos dinâmicos por marca (texto, número, data, booleano)
- [ ] Mapeamento na importação
- [ ] Uso como merge tags nas campanhas

**Tags:**
- [ ] Tags em contactos no contexto de marca
- [ ] Filtragem de listas por tag
- [ ] Segmentos baseados em tags

**Relatórios Avançados:**
- [ ] Dashboard multi-marca para `group_admin`
- [ ] Comparação de KPIs entre marcas
- [ ] Exportação de relatórios (CSV, Excel)
- [ ] Relatório de tendências (open rate ao longo do tempo)

**API Pública:**
- [ ] Endpoints REST `/api/v1/` com Laravel Sanctum
- [ ] Autenticação por API token
- [ ] Documentação OpenAPI/Swagger
- [ ] Rate limiting por token

**SSO Corporativo:**
- [ ] Microsoft Azure AD / SAML 2.0
- [ ] Mapeamento de grupos AD para papéis na plataforma
- [ ] Provisioning automático de utilizadores

**Performance:**
- [ ] Read replica para queries analíticas
- [ ] CDN para assets estáticos
- [ ] Lazy loading de componentes Vue
- [ ] Melhorias de query baseadas em métricas de produção

---

## Fase 3 — Escala (meses 9–18)

> **Objetivo:** Funcionalidades avançadas, automações, integrações externas e preparação para volume muito alto.

### Automações e Workflows

- [ ] Email workflows baseados em triggers (ex: welcome email após subscrição)
- [ ] Drip campaigns (sequência de emails no tempo)
- [ ] Triggers de comportamento: abriu email → enviar follow-up N dias depois
- [ ] Visual workflow builder

### A/B Testing

- [ ] Testes de assunto (subject line)
- [ ] Testes de conteúdo (versão A vs. B)
- [ ] Testes de hora de envio
- [ ] Winner automático com threshold configurável

### Integrações Externas

- [ ] Webhooks outbound (abertura, clique, bounce, unsubscribe → URL configurável)
- [ ] Integração CRM (Salesforce, HubSpot)
- [ ] Integração DMS automóvel (DealerSocket, Autoline)
- [ ] Zapier / Make (n8n) connectors

### Analytics Avançado

- [ ] Mapa de calor de cliques (heatmap)
- [ ] Análise de dispositivo/cliente de email
- [ ] Lifetime value de contacto (baseado em engajamento)
- [ ] Previsão de open rate (ML simples)
- [ ] Relatórios personalizados com filtros avançados

### Infraestrutura de Escala

- [ ] Migração de `email_events` para analytics DB (ClickHouse ou BigQuery)
- [ ] Envio de campanhas distribuído com workers horizontais
- [ ] Cache layer distribuída (Redis Cluster)
- [ ] Auto-scaling de workers em picos de envio

### Preference Center RGPD Completo

- [ ] Landing page de preferências para o destinatário
- [ ] Seleção de tópicos de comunicação (ex: "só quero promoções BMW", "não quero recalls")
- [ ] Histórico de consentimento auditável
- [ ] Export de dados pessoais (RGPD portabilidade) self-service

---

## Resumo Visual do Roadmap

```
Mês 1    Mês 2    Mês 3    Mês 4    Mês 5-6  Mês 7-8  Mês 9-12   Mês 13-18
  │        │        │        │         │        │         │          │
  ├───────────────────────────┤         │        │         │          │
  │      FASE 1 — MVP         │         │        │         │          │
  │   Base + Auth + Marcas    │         │        │         │          │
  │   + Contactos + Campanhas │         │        │         │          │
  │   + Relatórios básicos    │         │        │         │          │
  └───────────────────────────┤         │        │         │          │
                            🚀 MVP      │        │         │          │
                                        ├────────┤         │          │
                                        │ FASE 2A│         │          │
                                        │ Editor │         │          │
                                        │ Seg.   │         │          │
                                        │ 2FA    │         │          │
                                        └────────┤         │          │
                                                 ├─────────┤          │
                                                 │ FASE 2B │          │
                                                 │ API     │          │
                                                 │ SSO     │          │
                                                 │ Reports │          │
                                                 └─────────┤          │
                                                           ├──────────┤
                                                           │ FASE 3   │
                                                           │ Automação│
                                                           │ A/B Test │
                                                           │ Integr.  │
                                                           └──────────┘
```

---

*Próximo: [13 — Riscos e Mitigação](13-risks.md)*
