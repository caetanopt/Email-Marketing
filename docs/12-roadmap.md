# 12 — Roadmap por Fases

## Caetano PrimeMail — Da Fundação à Escala

---

## Fase 1 — MVP (0–4 meses)

> **Objetivo:** Lançar uma plataforma funcional, segura e rápida que cubra os casos de uso essenciais de email marketing multi-marca.

### Semanas 1–2: Fundação Técnica

**Infraestrutura e Setup:**
- [ ] Configuração do projeto Laravel 11 + PHP 8.3
- [ ] Docker Compose para desenvolvimento local (PHP, MySQL, Redis, MinIO, Mailpit, Horizon)
- [ ] CI/CD básico (GitHub Actions: lint, testes, deploy)
- [ ] Estrutura de pastas e padrões definidos (ver [11 — Organização do Código](11-api-code-organization.md))
- [ ] Migrations base: todas as tabelas definidas com índices corretos
- [ ] Seeds: papéis, permissões, marcas iniciais
- [ ] `.env.example` documentado

**Base técnica:**
- [ ] Global Scope de `brand_id` implementado e testado
- [ ] BrandAccessMiddleware funcional
- [ ] Sistema de auditoria (AuditLog model + trait)
- [ ] Políticas de autorização base (CampaignPolicy, ContactListPolicy, etc.)

---

### Semanas 3–4: Autenticação e Utilizadores

- [ ] Login seguro (email + password + Argon2id)
- [ ] Rate limiting e bloqueio após 5 tentativas
- [ ] Sessões Redis encriptadas
- [ ] Logout com invalidação de sessão
- [ ] Recuperação de password por email
- [ ] Verificação de email
- [ ] Registo de utilizadores por convite
- [ ] CRUD de utilizadores (admin)
- [ ] Papéis e permissões (6 papéis base)
- [ ] Testes de autenticação e brute force

---

### Semanas 5–6: Gestão de Marcas e Contexto

- [ ] CRUD de marcas (nome, slug, logótipo, cor, email remetente)
- [ ] Associação utilizador ↔ marca ↔ papel
- [ ] Dropdown de seleção de marca no topbar
- [ ] `BrandSwitchController` com validação de acesso
- [ ] Persistência do contexto de marca na sessão
- [ ] Dashboard por marca (estrutura base com dados reais)
- [ ] Testes de isolamento de marca (utilizador A não acede a dados de marca B)

---

### Semanas 7–9: Gestão de Contactos e Importação

- [ ] CRUD de listas de contactos (por marca)
- [ ] Adição manual de contacto
- [ ] Upload de ficheiro CSV/XLSX para S3
- [ ] Validação de ficheiro (MIME, tamanho, conteúdo)
- [ ] Interface de mapeamento de colunas
- [ ] `ParseImportHeadersJob` (assíncrono)
- [ ] `ProcessImportChunkJob` (chunks de 500, assíncrono)
- [ ] `FinalizeImportJob` com geração de ficheiro de erros
- [ ] Polling de progresso em tempo real no frontend
- [ ] Suppression list por marca
- [ ] Unsubscribes: link, landing page, processamento automático
- [ ] Histórico de importações
- [ ] Testes de importação (deduplicação, erros, progresso)

---

### Semanas 10–12: Campanhas e Envio

- [ ] Criação de campanha (wizard multi-passo)
- [ ] Editor HTML básico (textarea + preview)
- [ ] Seleção de listas destinatárias (da marca ativa)
- [ ] Merge tags básicos (`{{first_name}}`, `{{email}}`, `{{unsubscribe_url}}`)
- [ ] Envio de test email
- [ ] Agendamento de campanha
- [ ] Envio imediato com confirmação
- [ ] `SendCampaignJob` + `SendCampaignBatchJob` (assíncrono, chunks de 500)
- [ ] Estados de campanha (draft → scheduled → sending → sent/failed)
- [ ] Processamento de bounces via webhook (hard/soft)
- [ ] Templates HTML básicos por marca
- [ ] Testes de envio e estados de campanha

---

### Semanas 13–14: Relatórios e Métricas

- [ ] Tracking de aberturas (pixel 1x1 com buffer Redis)
- [ ] Tracking de cliques (redirect com buffer Redis)
- [ ] `FlushEmailEventsJob` (flush periódico Redis → MySQL)
- [ ] Página de relatório por campanha (métricas básicas)
- [ ] Dashboard com KPIs dos últimos 30 dias
- [ ] Webhook de bounce do provider de email
- [ ] Atualização de status de contacto (active → bounced)

---

### Semanas 15–16: Polimento, Segurança e Lançamento

- [ ] Revisão de segurança completa (checklist [09 — Segurança](09-security.md))
- [ ] Headers HTTP de segurança
- [ ] Teste de penetração básico (OWASP Top 10)
- [ ] Performance testing (import de 100k contactos, envio de 10k emails)
- [ ] Documentação de utilizador básica
- [ ] Setup de produção (Docker + cloud)
- [ ] Backups automáticos configurados e testados
- [ ] Monitorização (Sentry, Horizon, health check)
- [ ] **Lançamento MVP**

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
