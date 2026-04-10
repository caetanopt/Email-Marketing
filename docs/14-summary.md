# 14 — Resumo Executivo

## Caetano PrimeMail — Stack, Arquitetura, MVP e Prioridades

---

## Bloco 1 — Stack Recomendada

```
┌─────────────────────────────────────────────────────────────────────┐
│                    STACK CAETANO PRIMEMAIL                           │
├─────────────────────────┬───────────────────────────────────────────┤
│ CAMADA                  │ TECNOLOGIA                                 │
├─────────────────────────┼───────────────────────────────────────────┤
│ Backend                 │ PHP 8.3 + Laravel 11                       │
│ Frontend                │ Vue 3 + Inertia.js + Tailwind CSS          │
│ Base de dados           │ MySQL 8.0 (InnoDB)                         │
│ Cache / Sessões         │ Redis 7                                    │
│ Filas / Workers         │ Laravel Queues + Redis + Horizon           │
│ Ficheiros / Uploads     │ S3-compatible (MinIO dev / AWS S3 prod)    │
│ Email transacional      │ Laravel Mail → Mailgun / AWS SES           │
│ Email marketing (envio) │ SMTP próprio / SES / Mailgun por marca     │
│ Autenticação            │ Laravel Sanctum (sessões web)              │
│ Contentor               │ Docker + Docker Compose                    │
│ Infraestrutura (prod)   │ AWS (EC2 + RDS + ElastiCache + S3)         │
│ Erros / Monitorização   │ Sentry + Laravel Telescope                 │
│ Filas (dashboard)       │ Laravel Horizon                            │
│ CI/CD                   │ GitHub Actions                             │
├─────────────────────────┴───────────────────────────────────────────┤
│                                                                      │
│  Justificação das escolhas-chave:                                    │
│                                                                      │
│  • Laravel 11: framework PHP mais maduro, produtivo e seguro.        │
│    Queues, auth, ORM, jobs — tudo nativo, sem reinventar.            │
│                                                                      │
│  • Inertia.js: SPA sem a complexidade de uma API REST separada.      │
│    Perfeito para o MVP. API REST pode ser adicionada em V2           │
│    sem alterar o backend.                                            │
│                                                                      │
│  • MySQL 8: maduro, estável, excelente com índices compostos.        │
│    InnoDB row-level locking adequado para imports concorrentes.      │
│                                                                      │
│  • Redis: filas + cache + sessões num único serviço.                 │
│    Indispensável para o modelo assíncrono da plataforma.             │
│                                                                      │
│  • Argon2id: hash de password moderno, memory-hard.                  │
│    Escolha correta para 2026 em diante.                              │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Bloco 2 — Arquitetura Recomendada

```
┌─────────────────────────────────────────────────────────────────────┐
│                  ARQUITETURA CAETANO PRIMEMAIL                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  DESIGN PRINCIPLES:                                                  │
│  1. Multi-brand: brand_id em cada entidade, Global Scope em Laravel  │
│  2. Async-first: nada pesado no thread do request (< 200ms)         │
│  3. Security layers: Auth → Brand Access → Permission → Policy       │
│  4. Performance by design: índices compostos + cache + paginação     │
│                                                                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  CAMADAS DA APLICAÇÃO:                                               │
│                                                                      │
│  Request → Middleware Stack → Controller → Action/Service → Model    │
│                                                                      │
│  Middleware Stack (em ordem):                                        │
│    1. auth          — utilizador autenticado?                        │
│    2. verified      — email verificado?                              │
│    3. active_brand  — marca ativa selecionada?                       │
│    4. brand.access  — utilizador tem acesso a esta marca?            │
│    5. permission    — utilizador tem a permissão necessária?         │
│                                                                      │
│  Controller → Action:                                                │
│    Controller = validação + autorização + resposta HTTP              │
│    Action = lógica de negócio pura, testável, reutilizável           │
│                                                                      │
│  Model + Global Scope:                                               │
│    Todos os models com brand_id têm BrandScope ativo                 │
│    Queries automáticas: WHERE brand_id = session('active_brand_id') │
│                                                                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  FLUXO DE DADOS — IMPORTAÇÃO:                                        │
│  Upload → S3 → ParseJob → MappingUI → ChunkJobs → DB + Progress      │
│                                                                      │
│  FLUXO DE DADOS — ENVIO DE CAMPANHA:                                 │
│  Confirm → SendJob → BatchJobs → SMTP/API → Events(Redis) → DB       │
│                                                                      │
│  ESTRATÉGIA DE BASE DE DADOS:                                        │
│  Single DB + brand_id (não multi-schema)                             │
│  Particionamento: email_events (por trimestre), audit_logs           │
│  Índices compostos: sempre brand_id como prefixo                     │
│  Counters atómicos: total_contacts, active_contacts em contact_lists │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Bloco 3 — MVP Ideal

```
┌─────────────────────────────────────────────────────────────────────┐
│                      MVP CAETANO PRIMEMAIL                           │
│                   (16 semanas / ~4 meses)                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ✅ AUTENTICAÇÃO:                                                    │
│     Login seguro | Logout | Recuperação password | Verificação email │
│     Rate limiting | Audit logs | Sessões Redis                       │
│                                                                      │
│  ✅ UTILIZADORES:                                                    │
│     Criação por convite | 6 papéis | Permissões por marca            │
│                                                                      │
│  ✅ MARCAS:                                                          │
│     CRUD completo | Dropdown seletor | Troca de contexto             │
│     Persistência de marca ativa | Validação de acesso               │
│                                                                      │
│  ✅ CONTACTOS:                                                       │
│     Listas por marca | Importação CSV/XLSX assíncrona               │
│     Deduplicação | Progresso em tempo real | Histórico importações   │
│     Unsubscribes automáticos | Suppression list                      │
│                                                                      │
│  ✅ CAMPANHAS:                                                       │
│     Criação | Editor HTML | Merge tags | Test email                  │
│     Agendamento | Envio imediato | Envio assíncrono em batch         │
│     Estados: draft→scheduled→sending→sent/failed                    │
│                                                                      │
│  ✅ TEMPLATES:                                                       │
│     Templates HTML por marca | Templates partilhados grupo          │
│                                                                      │
│  ✅ RELATÓRIOS BÁSICOS:                                             │
│     Métricas por campanha: entregues, aberturas, cliques             │
│     Bounces, unsubscribes | Dashboard com KPIs por marca             │
│                                                                      │
│  ✅ BASE TÉCNICA:                                                    │
│     PHP 8.3 + Laravel 11 + MySQL + Redis + S3 + Docker               │
│     Índices compostos brand_id | Global Scope | Horizon              │
│     Sentry | Backups | Security headers                              │
│                                                                      │
│  ❌ FORA DO MVP (V2+):                                               │
│     Editor drag-and-drop | Segmentos dinâmicos | 2FA                │
│     Campos personalizados | Tags | API pública | SSO                 │
│     Relatórios multi-marca | Automações | A/B Testing                │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Bloco 4 — Maiores Prioridades Técnicas desde o Dia 1

```
┌─────────────────────────────────────────────────────────────────────┐
│           TOP 10 PRIORIDADES TÉCNICAS — DIA 1                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. ÍNDICES COMPOSTOS COM brand_id                                  │
│     Criar os índices corretos ANTES de inserir dados.               │
│     Adicionar depois é muito mais difícil e arriscado.              │
│     Regra: todo índice em tabela com brand_id começa com brand_id.  │
│                                                                      │
│  2. GLOBAL SCOPE DE MARCA EM TODOS OS MODELS RELEVANTES             │
│     Implementar e testar antes de qualquer CRUD.                    │
│     Testar explicitamente que dados de marcas diferentes não        │
│     se misturam NUNCA.                                               │
│                                                                      │
│  3. PROCESSAMENTO ASSÍNCRONO DESDE O INÍCIO                         │
│     Nunca implementar importação ou envio de forma síncrona.        │
│     Começar com jobs e filas desde o primeiro endpoint.             │
│                                                                      │
│  4. ARGON2ID PARA PASSWORDS                                         │
│     Configurar ANTES do primeiro utilizador ser criado.             │
│     Não é possível migrar passwords existentes facilmente.          │
│                                                                      │
│  5. AUDIT LOGS IMUTÁVEIS DESDE O DIA 1                              │
│     Cada ação crítica deve ser registada.                           │
│     O audit log é o seguro de conformidade RGPD.                   │
│                                                                      │
│  6. SESSÕES EM REDIS, NÃO EM FICHEIROS                              │
│     Para multi-servidor, expiração correta e segurança.             │
│     Configurar com encriptação ativa.                               │
│                                                                      │
│  7. SUPPRESSION LIST VERIFICADA EM TODAS AS OPERAÇÕES               │
│     No import → não importar emails suprimidos.                     │
│     No envio → não enviar para emails suprimidos.                   │
│     Nunca há segunda oportunidade após um unsubscribe.              │
│                                                                      │
│  8. MIGRATIONS COM ÍNDICES CORRETOS                                  │
│     Cada migration deve incluir os índices da tabela.               │
│     Nunca criar uma tabela com brand_id sem índice composto.        │
│                                                                      │
│  9. TESTES DE SEGURANÇA DE ISOLAMENTO DE MARCA                      │
│     Antes do lançamento: utilizador A não pode aceder a dados B.    │
│     Test suite dedicada para cross-brand access.                    │
│                                                                      │
│  10. HEALTH CHECK E MONITORIZAÇÃO ANTES DO LANÇAMENTO               │
│      /health endpoint | Sentry | Horizon | Alertas.                 │
│      Não lançar sem visibilidade do estado do sistema.              │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Síntese Final

O **Caetano PrimeMail** é uma plataforma ambiciosa mas completamente viável com a stack e abordagem descritas neste documento.

A chave para o sucesso está em três decisões que têm de ser tomadas desde o início e não podem ser revertidas facilmente:

1. **Índices corretos** — são a fundação da performance. Impossível adicionar em produção sem downtime significativo.

2. **Global Scope de marca** — é a fundação da segurança e do isolamento de dados. Deve estar presente em todos os models antes de qualquer dado ser inserido.

3. **Processamento assíncrono** — é a fundação da experiência do utilizador. Nunca implementar importações ou envios de forma síncrona, mesmo que "seja mais simples para começar".

Estas três decisões, tomadas no dia 1, garantem que a plataforma pode crescer de forma saudável até à Fase 3 e além, sem necessidade de reescritas significativas.

---

*Documentação completa: ver índice em [README.md](../README.md)*
