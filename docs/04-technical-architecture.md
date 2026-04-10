# 04 — Arquitetura Técnica

## Caetano PrimeMail — Stack e Infraestrutura

---

## 4.1 Stack Recomendada

### Justificação das Escolhas

A stack foi escolhida com base em quatro critérios:
1. **Velocidade de desenvolvimento** — ecossistema maduro, boas abstrações
2. **Performance** — adequada para volumes altos com as estratégias corretas
3. **Segurança** — frameworks com proteções nativas
4. **Manutenção futura** — código limpo, testável, documentado

---

### Backend — PHP 8.3 + Laravel 11

**Porquê Laravel?**
- Framework PHP mais maduro e produtivo do ecossistema atual
- Queues e workers nativos (Laravel Queues + Horizon)
- ORM Eloquent com scope de brand_id simples de implementar
- Autenticação e autorização nativas (Sanctum, Gates, Policies)
- Form Requests para validação centralizada
- Jobs e Batches para processamento assíncrono
- Storage abstraction para S3, local, etc.
- Laravel Scout para search (V2)
- Ecosystem maduro: Telescope, Horizon, Pint, Sail

**Versão:** PHP 8.3 LTS + Laravel 11

**Justificação PHP 8.3:**
- Tipos mais expressivos (fibers, readonly properties, intersection types)
- Performance melhorada (JIT em operações CPU-intensive)
- `readonly` classes para DTOs imutáveis
- Enum nativo para estados de campanha, papéis, etc.

---

### Frontend — Inertia.js + Vue 3 + Tailwind CSS

**Porquê Inertia.js?**
- Permite construir uma SPA sem a complexidade de uma API REST separada
- O backend Laravel serve as páginas diretamente, sem JSON API overhead no MVP
- Transições de página sem reload completo (SPA-like experience)
- Partilha do sistema de routing do Laravel
- Permite adicionar uma API REST separada no futuro sem reescrever o backend
- Sem contexto duplicado: as views recebem exatamente os dados que precisam

**Porquê Vue 3?**
- Composition API para lógica reutilizável
- Pinia para estado global (marca ativa, utilizador, permissões)
- Ecossistema rico: Vueuse, VueDraggable para editor V2, etc.

**Porquê Tailwind CSS?**
- Desenvolvimento de UI rápido sem CSS personalizado excessivo
- Design system consistente com classes utilitárias
- Headless UI ou shadcn/vue para componentes acessíveis

> **Alternativa considerada e descartada:** Next.js + API REST separada. Descartado porque aumenta complexidade de infraestrutura, duplica autenticação e atrasa o MVP sem benefício real para este caso de uso.

---

### Base de Dados — MySQL 8.0

**Porquê MySQL?**
- Maduro, estável, amplamente conhecido pela maioria das equipas PHP
- InnoDB com suporte a transações ACID
- Excelente performance com índices bem definidos
- Suporte nativo a JSON columns (campos customizados, metadata)
- Full-text search (básico, Scout para V2)
- Particionamento de tabelas por range/list (para `email_events` e `audit_logs`)
- Replicação read/write nativa

**Versão:** MySQL 8.0+

**Trade-off com PostgreSQL:**
- PostgreSQL é tecnicamente superior em alguns aspetos (JSONB, arrays nativos, window functions mais potentes)
- Escolhemos MySQL pela familiaridade da equipa PHP e pelo ecossistema Laravel mais testado com MySQL
- A migração para PostgreSQL no futuro é viável se necessário

---

### Cache e Filas — Redis 7

**Redis para:**
1. **Filas (Queues):** Jobs de importação, envio de campanhas, processamento de eventos
2. **Cache:** Resultados de queries frequentes (ex: contagem de contactos por lista, métricas do dashboard)
3. **Rate Limiting:** Proteção brute force no login e endpoints críticos
4. **Sessões:** Armazenamento de sessões (alternativa a ficheiros ou DB)
5. **Pub/Sub:** Progresso de importação em tempo real (V2 com WebSockets)
6. **Locks distribuídos:** Prevenção de processamento duplicado de jobs

**Versão:** Redis 7.0+

---

### Processamento Assíncrono — Laravel Queues + Horizon

**Laravel Horizon** é um dashboard para monitorização das filas Redis.

**Filas definidas (com prioridades):**

| Fila | Prioridade | Uso |
|------|------------|-----|
| `critical` | 1 | Emails transacionais (reset de password, verificação) |
| `high` | 2 | Processamento de bounces, unsubscribes |
| `default` | 3 | Envio de campanhas, notificações internas |
| `imports` | 4 | Processamento de importações de contactos |
| `reports` | 5 | Geração de relatórios, agregações de métricas |
| `cleanup` | 6 | Limpeza de ficheiros temporários, archiving |

**Workers recomendados:**

```
# worker crítico e alto (1 processo)
php artisan queue:work redis --queue=critical,high --tries=3

# worker de envio de campanhas (2-4 processos, escala horizontal)
php artisan queue:work redis --queue=default --tries=3

# worker de importações (2 processos dedicados)
php artisan queue:work redis --queue=imports --tries=1 --timeout=3600

# worker de relatórios e limpeza (1 processo)
php artisan queue:work redis --queue=reports,cleanup --tries=3
```

---

### Armazenamento de Ficheiros — S3-Compatible

**Para desenvolvimento:** MinIO (Docker) — API 100% compatível com S3
**Para produção:** AWS S3 ou equivalente (Wasabi, Cloudflare R2)

**Ficheiros armazenados:**
- Ficheiros CSV/Excel importados (temporariamente, até processamento + N dias)
- Ficheiros de erros de importação
- Logótipos de marcas
- Avatares de utilizadores
- Ficheiros de export de relatórios (CSV gerados)

**Política de retenção:**
- Ficheiros de importação: 30 dias após processamento completo
- Ficheiros de erro: 90 dias
- Exports: 7 dias (gerados sob pedido)

---

### Envio de Emails — SMTP / API

**Para emails transacionais** (reset password, verificação, notificações):
- Laravel Mail via Mailgun, AWS SES ou SMTP próprio
- Configuração global da plataforma

**Para envio de campanhas:**
- Por marca, configuração de SMTP ou API de envio própria
- Suporte a: AWS SES, Mailgun, SendGrid, SMTP personalizado
- Bounce handling via webhooks de cada provider
- Tracking de aberturas via pixel 1x1 (servido pelo próprio servidor)
- Tracking de cliques via redirect no próprio servidor

**Entregabilidade:**
- Cada marca deve ter SPF, DKIM e DMARC configurados
- Separação de IPs de envio de campanhas vs. emails transacionais
- Warm-up de novos IPs de envio

---

### Infraestrutura — Docker + Cloud

**Desenvolvimento local:**
```yaml
# docker-compose.yml (serviços principais)
services:
  app:        # PHP-FPM 8.3 + Laravel
  nginx:      # Nginx como reverse proxy
  mysql:      # MySQL 8.0
  redis:      # Redis 7
  minio:      # S3-compatible para ficheiros
  horizon:    # Laravel Horizon (monitorização de filas)
  mailpit:    # SMTP local para testar emails
```

**Produção (recomendada):**

```
[ CloudFlare / Load Balancer ]
          ↓
[ Nginx (reverse proxy) ]
          ↓
[ PHP-FPM App Servers ] ← escala horizontal
          ↓                    ↓
[ MySQL Primary ]      [ Redis Cluster ]
[ MySQL Replica ]
          ↓
[ S3-compatible Storage ]
          ↓
[ Queue Workers (separados dos app servers) ]
```

**Opções de hosting:**
- **AWS** (EC2 + RDS + ElastiCache + S3 + SES) — recomendado para produção
- **Hetzner Cloud** + managed MySQL — opção económica de alta performance
- **Render / Railway** — para prototipagem rápida
- **VPS próprio** — se requisito de on-premise

---

## 4.2 Diagrama de Componentes

```
┌─────────────────────────────────────────────────────────────┐
│                     CAETANO PRIMEMAIL                        │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Frontend (Vue 3 + Inertia)              │   │
│  │  ┌─────────────┐  ┌────────────┐  ┌──────────────┐  │   │
│  │  │  Dashboard  │  │ Campaigns  │  │  Contacts    │  │   │
│  │  │  (by brand) │  │  Manager   │  │  & Imports   │  │   │
│  │  └─────────────┘  └────────────┘  └──────────────┘  │   │
│  └──────────────────────────────────────────────────────┘   │
│                           │                                  │
│                     Inertia SSR                              │
│                           │                                  │
│  ┌──────────────────────────────────────────────────────┐   │
│  │          Backend (PHP 8.3 + Laravel 11)              │   │
│  │  ┌──────────┐ ┌──────────┐ ┌───────────┐            │   │
│  │  │ Auth &   │ │ Brand    │ │ Campaign  │            │   │
│  │  │ Users    │ │ Context  │ │ Service   │            │   │
│  │  └──────────┘ └──────────┘ └───────────┘            │   │
│  │  ┌──────────┐ ┌──────────┐ ┌───────────┐            │   │
│  │  │ Import   │ │ Email    │ │ Analytics │            │   │
│  │  │ Service  │ │ Sender   │ │ Service   │            │   │
│  │  └──────────┘ └──────────┘ └───────────┘            │   │
│  └──────────────────────────────────────────────────────┘   │
│          │              │              │                     │
│  ┌───────────┐  ┌──────────────┐  ┌──────────┐             │
│  │  MySQL 8  │  │  Redis 7     │  │  S3      │             │
│  │  (dados)  │  │  (filas/     │  │  (files) │             │
│  │           │  │   cache)     │  │          │             │
│  └───────────┘  └──────────────┘  └──────────┘             │
│                        │                                     │
│  ┌────────────────────────────────────────────────────┐     │
│  │              Queue Workers                          │     │
│  │  [Import Worker] [Campaign Worker] [Events Worker] │     │
│  └────────────────────────────────────────────────────┘     │
│                        │                                     │
│  ┌──────────────────────────────────────────────────┐       │
│  │          Email Delivery (SES / Mailgun)           │       │
│  │     + Bounce/Webhook Receiver                     │       │
│  └──────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

---

## 4.3 Observabilidade e Monitorização

### Logging
- **Laravel Log** com drivers: `daily` (ficheiros rotativos) + `stack`
- Logs estruturados em JSON (para ingestão em sistemas de log)
- Contexto sempre presente nos logs: `user_id`, `brand_id`, `request_id`
- Níveis: DEBUG (dev), INFO, WARNING, ERROR, CRITICAL

### Desenvolvimento
- **Laravel Telescope** — debug de requests, queries, jobs, emails, exceptions
- Acesso restrito a `super_admin` em produção

### Erros e Exceções
- **Sentry** — rastreamento de exceções em produção, alertas automáticos, stack traces
- Filtros para não enviar dados pessoais para Sentry (PII scrubbing)

### Métricas de Infraestrutura
- **Laravel Horizon** — métricas de filas: throughput, failed jobs, tempo de espera
- **Prometheus + Grafana** (V2) — métricas de CPU, memória, queries, throughput de envio

### Health Checks
- Endpoint `/health` que verifica: DB, Redis, S3, filas
- Monitorização externa (UptimeRobot ou similar) sobre o endpoint de health

### Alertas
- Email/Slack quando: taxa de bounce > threshold, fila com backlog, error rate elevada, job failed
- Configuráveis por `super_admin`

---

## 4.4 Decisões Técnicas e Trade-offs

### Decisão 1: Inertia.js vs. API REST + SPA separada

**Escolha:** Inertia.js no MVP
**Razão:** Menos complexidade, uma única codebase PHP, autenticação unificada, mais rápido de desenvolver.
**Trade-off:** No futuro, se for necessária uma API pública para integrações, é necessário adicionar endpoints REST/API explícitos. Mas isso é V2 e não bloqueia o MVP.

### Decisão 2: Sessões tradicionais vs. JWT

**Escolha:** Sessões Laravel (server-side sessions com Sanctum para web)
**Razão:** Mais seguro para web apps (sem JWT storage em localStorage), invalidação imediata possível, revogação de sessão nativa.
**Trade-off:** Não é stateless — exige Redis/DB para sessões em múltiplos servidores. Resolvido com sessões Redis.

### Decisão 3: MySQL vs. PostgreSQL

**Escolha:** MySQL 8.0
**Razão:** Familiaridade da equipa, ecossistema Laravel mais testado, particionamento adequado, JSON columns suficientes.
**Trade-off:** PostgreSQL seria melhor para algumas queries analíticas complexas. Mitigado com agregações em jobs assíncronos.

### Decisão 4: Multi-brand com `brand_id` em cada tabela vs. schemas separados

**Escolha:** Single database com `brand_id` em cada tabela relevante
**Razão:** Simples de implementar, queries cross-brand para admins são diretas, sem overhead de gestão de schemas, índices compostos garantem performance.
**Trade-off:** Crescimento da base de dados é partilhado. Mitigado com particionamento de tabelas de eventos ao crescer.
**Detalhe:** Ver [05 — Arquitetura de Dados](05-data-architecture.md)

### Decisão 5: Tracking de aberturas e cliques

**Escolha:** Pixel de tracking servido pelo próprio servidor + redirects de clique
**Razão:** Controlo total, privacidade, sem dependência de terceiros para tracking.
**Trade-off:** Volume de requests de tracking pode ser alto. Mitigado com endpoint otimizado (sem middleware pesado), registo em Redis com flush assíncrono para MySQL.

---

*Próximo: [05 — Arquitetura de Dados](05-data-architecture.md)*
