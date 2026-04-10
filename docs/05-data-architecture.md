# 05 — Arquitetura de Dados

## Caetano PrimeMail — Entidades, Relações e Estratégia Multi-Marca

---

## 5.1 Estratégia Multi-Marca: Abordagem Recomendada

### Opções Consideradas

| Abordagem | Descrição | Pro | Contra |
|-----------|-----------|-----|--------|
| **Single DB + `brand_id`** | Uma base de dados, `brand_id` em cada tabela | Simples, queries cross-brand fáceis, manutenção baixa | Crescimento partilhado, requer índices corretos |
| **Schema por marca** | Um schema MySQL por marca | Isolamento total | Complexidade operacional alta, queries cross-brand difíceis |
| **Database por marca** | Uma base de dados por marca | Isolamento máximo | Infraestrutura cara, migrações complexas, sem visão agregada |
| **Row-level security** | PostgreSQL RLS | Isolamento a nível de DB | Requer PostgreSQL, complexidade de implementação |

### Decisão: Single Database com `brand_id` Obrigatório

**Justificação:**
- Equipa PHP/Laravel — implementação simples com Global Scopes
- Queries cross-brand para admins são diretas
- Uma única migration history
- Backups e manutenção simples
- Índices compostos `(brand_id, ...)` garantem performance
- Particionamento de tabelas de eventos pode ser adicionado quando o volume justificar

**Implementação em Laravel:**
```php
// BrandScope global em todos os models que têm brand_id
class BrandScope implements Scope
{
    public function apply(Builder $builder, Model $model): void
    {
        if ($brandId = session('active_brand_id')) {
            $builder->where($model->getTable() . '.brand_id', $brandId);
        }
    }
}

// Nos models relevantes:
protected static function booted(): void
{
    static::addGlobalScope(new BrandScope());
}
```

```php
// Para queries cross-brand (admins):
Campaign::withoutGlobalScope(BrandScope::class)->get();
```

---

## 5.2 Entidades Principais e Estrutura

---

### `users`
**Objetivo:** Armazena os utilizadores da plataforma (autenticados).

```sql
CREATE TABLE users (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name            VARCHAR(255) NOT NULL,
    email           VARCHAR(255) NOT NULL UNIQUE,
    email_verified_at TIMESTAMP NULL,
    password        VARCHAR(255) NOT NULL,      -- bcrypt/argon2
    avatar_path     VARCHAR(500) NULL,
    status          ENUM('active','inactive','suspended') DEFAULT 'active',
    last_login_at   TIMESTAMP NULL,
    last_login_ip   VARCHAR(45) NULL,           -- IPv4 ou IPv6
    active_brand_id BIGINT UNSIGNED NULL,       -- FK para brands (contexto ativo)
    remember_token  VARCHAR(100) NULL,
    created_at      TIMESTAMP NULL,
    updated_at      TIMESTAMP NULL,
    deleted_at      TIMESTAMP NULL              -- soft delete
);
```

**Índices:**
```sql
INDEX idx_users_email (email)
INDEX idx_users_status (status)
INDEX idx_users_active_brand (active_brand_id)
```

**Relações:**
- `hasMany` → `user_brand_roles` (papéis em marcas)
- `belongsTo` → `brands` (marca ativa)
- `hasMany` → `login_sessions`
- `hasMany` → `audit_logs`

---

### `roles`
**Objetivo:** Define os papéis disponíveis na plataforma.

```sql
CREATE TABLE roles (
    id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(50) NOT NULL UNIQUE,    -- 'super_admin', 'brand_admin', etc.
    display_name VARCHAR(100) NOT NULL,
    description TEXT NULL,
    created_at  TIMESTAMP NULL,
    updated_at  TIMESTAMP NULL
);
```

**Dados iniciais (seeds):**
- `super_admin` — Administrador Global
- `group_admin` — Administrador de Grupo
- `brand_admin` — Administrador de Marca
- `marketing_manager` — Gestor de Marketing
- `marketing_coordinator` — Coordenador de Marketing
- `analyst` — Analista (leitura)

---

### `permissions`
**Objetivo:** Define permissões granulares associáveis a papéis.

```sql
CREATE TABLE permissions (
    id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(100) NOT NULL UNIQUE,   -- 'campaigns.create', 'contacts.import', etc.
    display_name VARCHAR(255) NOT NULL,
    module      VARCHAR(50) NOT NULL,           -- 'campaigns', 'contacts', 'brands', etc.
    created_at  TIMESTAMP NULL,
    updated_at  TIMESTAMP NULL
);
```

**Tabela pivot:**
```sql
CREATE TABLE role_permissions (
    role_id         BIGINT UNSIGNED NOT NULL,
    permission_id   BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (role_id, permission_id)
);
```

---

### `brands`
**Objetivo:** Entidade central de marca — contexto de toda a operação.

```sql
CREATE TABLE brands (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name                VARCHAR(255) NOT NULL,
    slug                VARCHAR(100) NOT NULL UNIQUE,  -- 'bmw', 'hyundai'
    logo_path           VARCHAR(500) NULL,
    primary_color       VARCHAR(7) NULL,               -- '#1C69D4'
    from_name           VARCHAR(255) NULL,
    from_email          VARCHAR(255) NULL,
    reply_to_email      VARCHAR(255) NULL,
    email_footer_html   TEXT NULL,
    physical_address    TEXT NULL,                     -- CAN-SPAM / RGPD
    unsubscribe_url     VARCHAR(500) NULL,
    smtp_config         JSON NULL,                     -- encriptado
    status              ENUM('active','inactive') DEFAULT 'active',
    created_by          BIGINT UNSIGNED NULL,          -- FK users
    created_at          TIMESTAMP NULL,
    updated_at          TIMESTAMP NULL,
    deleted_at          TIMESTAMP NULL
);
```

**Índices:**
```sql
INDEX idx_brands_slug (slug)
INDEX idx_brands_status (status)
```

**Relações:**
- `hasMany` → `user_brand_roles`
- `hasMany` → `contact_lists`
- `hasMany` → `campaigns`
- `hasMany` → `templates`
- `hasMany` → `suppression_list`

---

### `user_brand_roles`
**Objetivo:** Define que papel tem cada utilizador em cada marca.

```sql
CREATE TABLE user_brand_roles (
    id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id     BIGINT UNSIGNED NOT NULL,
    brand_id    BIGINT UNSIGNED NOT NULL,
    role_id     BIGINT UNSIGNED NOT NULL,
    granted_by  BIGINT UNSIGNED NULL,          -- quem atribuiu
    granted_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_at  TIMESTAMP NULL,
    created_at  TIMESTAMP NULL,
    updated_at  TIMESTAMP NULL,
    UNIQUE KEY unique_user_brand_role (user_id, brand_id, role_id)
);
```

**Índices:**
```sql
INDEX idx_ubr_user_brand (user_id, brand_id)
INDEX idx_ubr_brand (brand_id)
INDEX idx_ubr_role (role_id)
```

---

### `contact_lists`
**Objetivo:** Agrupa contactos numa lista associada a uma marca.

```sql
CREATE TABLE contact_lists (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    brand_id        BIGINT UNSIGNED NOT NULL,
    name            VARCHAR(255) NOT NULL,
    description     TEXT NULL,
    total_contacts  INT UNSIGNED DEFAULT 0,     -- cache counter
    active_contacts INT UNSIGNED DEFAULT 0,     -- cache counter
    status          ENUM('active','archived') DEFAULT 'active',
    created_by      BIGINT UNSIGNED NULL,
    created_at      TIMESTAMP NULL,
    updated_at      TIMESTAMP NULL,
    deleted_at      TIMESTAMP NULL
);
```

**Índices:**
```sql
INDEX idx_cl_brand_id (brand_id)
INDEX idx_cl_brand_status (brand_id, status)
```

---

### `contacts`
**Objetivo:** Entidade de contacto única, identificada por email. Não duplicada entre marcas.

```sql
CREATE TABLE contacts (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    email           VARCHAR(320) NOT NULL UNIQUE,   -- email normalizado lowercase
    email_hash      CHAR(64) NOT NULL UNIQUE,       -- SHA-256 do email (para lookups rápidos)
    first_name      VARCHAR(255) NULL,
    last_name       VARCHAR(255) NULL,
    phone           VARCHAR(50) NULL,
    company         VARCHAR(255) NULL,
    created_at      TIMESTAMP NULL,
    updated_at      TIMESTAMP NULL
);
```

**Índices:**
```sql
INDEX idx_contacts_email (email)
INDEX idx_contacts_email_hash (email_hash)
```

> **Nota de design:** Os dados sensíveis do contacto ficam aqui. As relações com marcas, listas e consentimento estão em tabelas separadas. Isto facilita o "direito ao esquecimento" (apagar os dados pessoais mantendo o registo de unsubscribe).

---

### `contact_list_members`
**Objetivo:** Relação muitos-para-muitos entre contactos e listas, com metadados de estado.

```sql
CREATE TABLE contact_list_members (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    contact_id      BIGINT UNSIGNED NOT NULL,
    list_id         BIGINT UNSIGNED NOT NULL,
    brand_id        BIGINT UNSIGNED NOT NULL,       -- desnormalizado para índice composto
    status          ENUM('active','unsubscribed','bounced','cleaned') DEFAULT 'active',
    custom_fields   JSON NULL,                      -- campos personalizados por marca
    subscribed_at   TIMESTAMP NULL,
    unsubscribed_at TIMESTAMP NULL,
    bounce_type     ENUM('hard','soft') NULL,
    import_id       BIGINT UNSIGNED NULL,            -- qual importação adicionou
    created_at      TIMESTAMP NULL,
    updated_at      TIMESTAMP NULL,
    UNIQUE KEY unique_contact_list (contact_id, list_id)
);
```

**Índices:**
```sql
INDEX idx_clm_list_id (list_id)
INDEX idx_clm_brand_status (brand_id, status)
INDEX idx_clm_contact_id (contact_id)
INDEX idx_clm_list_status (list_id, status)
INDEX idx_clm_import_id (import_id)
```

---

### `contact_brand_relations`
**Objetivo:** Regista a relação de consentimento e estado de um contacto com uma marca.

```sql
CREATE TABLE contact_brand_relations (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    contact_id          BIGINT UNSIGNED NOT NULL,
    brand_id            BIGINT UNSIGNED NOT NULL,
    consent_status      ENUM('opted_in','opted_out','unknown') DEFAULT 'unknown',
    consent_source      VARCHAR(100) NULL,          -- 'import', 'form', 'manual'
    consent_date        TIMESTAMP NULL,
    opt_out_date        TIMESTAMP NULL,
    opt_out_source      VARCHAR(100) NULL,          -- 'unsubscribe_link', 'manual', 'bounce'
    global_unsubscribe  BOOLEAN DEFAULT FALSE,      -- unsubscribe de todas as comunicações da marca
    created_at          TIMESTAMP NULL,
    updated_at          TIMESTAMP NULL,
    UNIQUE KEY unique_contact_brand (contact_id, brand_id)
);
```

**Índices:**
```sql
INDEX idx_cbr_brand_consent (brand_id, consent_status)
INDEX idx_cbr_contact (contact_id)
```

---

### `contact_tags`
**Objetivo:** Tags associadas a contactos no contexto de uma marca.

```sql
CREATE TABLE tags (
    id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    brand_id    BIGINT UNSIGNED NOT NULL,
    name        VARCHAR(100) NOT NULL,
    color       VARCHAR(7) NULL,                -- cor de display
    created_at  TIMESTAMP NULL,
    UNIQUE KEY unique_brand_tag (brand_id, name)
);

CREATE TABLE contact_tag_relations (
    contact_id  BIGINT UNSIGNED NOT NULL,
    tag_id      BIGINT UNSIGNED NOT NULL,
    brand_id    BIGINT UNSIGNED NOT NULL,
    created_at  TIMESTAMP NULL,
    PRIMARY KEY (contact_id, tag_id),
    INDEX idx_ctr_brand_tag (brand_id, tag_id),
    INDEX idx_ctr_contact (contact_id)
);
```

---

### `segments`
**Objetivo:** Segmentos dinâmicos de contactos baseados em regras.

```sql
CREATE TABLE segments (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    brand_id        BIGINT UNSIGNED NOT NULL,
    list_id         BIGINT UNSIGNED NULL,           -- NULL = aplica a todos os contactos da marca
    name            VARCHAR(255) NOT NULL,
    description     TEXT NULL,
    conditions      JSON NOT NULL,                  -- [{field, operator, value}, ...] com AND/OR
    estimated_count INT UNSIGNED NULL,              -- cache da última estimativa
    estimated_at    TIMESTAMP NULL,
    created_by      BIGINT UNSIGNED NULL,
    created_at      TIMESTAMP NULL,
    updated_at      TIMESTAMP NULL
);
```

**Índices:**
```sql
INDEX idx_segments_brand (brand_id)
INDEX idx_segments_brand_list (brand_id, list_id)
```

---

### `imports`
**Objetivo:** Registo de cada importação de contactos.

```sql
CREATE TABLE imports (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    brand_id            BIGINT UNSIGNED NOT NULL,
    list_id             BIGINT UNSIGNED NOT NULL,
    user_id             BIGINT UNSIGNED NOT NULL,
    file_name           VARCHAR(500) NOT NULL,      -- nome original do ficheiro
    file_path           VARCHAR(500) NOT NULL,      -- path no S3
    file_size           BIGINT UNSIGNED NULL,       -- bytes
    file_type           VARCHAR(50) NULL,           -- 'csv', 'xlsx'
    column_mapping      JSON NULL,                  -- mapeamento de colunas
    status              ENUM('pending','processing','completed','failed','cancelled') DEFAULT 'pending',
    total_rows          INT UNSIGNED NULL,
    processed_rows      INT UNSIGNED DEFAULT 0,
    imported_count      INT UNSIGNED DEFAULT 0,
    updated_count       INT UNSIGNED DEFAULT 0,
    skipped_count       INT UNSIGNED DEFAULT 0,
    error_count         INT UNSIGNED DEFAULT 0,
    error_file_path     VARCHAR(500) NULL,          -- path do ficheiro de erros no S3
    started_at          TIMESTAMP NULL,
    completed_at        TIMESTAMP NULL,
    error_message       TEXT NULL,
    created_at          TIMESTAMP NULL,
    updated_at          TIMESTAMP NULL
);
```

**Índices:**
```sql
INDEX idx_imports_brand (brand_id)
INDEX idx_imports_brand_list (brand_id, list_id)
INDEX idx_imports_status (status)
INDEX idx_imports_user (user_id)
```

---

### `campaigns`
**Objetivo:** Campanhas de email marketing.

```sql
CREATE TABLE campaigns (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    brand_id        BIGINT UNSIGNED NOT NULL,
    name            VARCHAR(255) NOT NULL,
    subject         VARCHAR(998) NOT NULL,          -- RFC 5321 max
    preview_text    VARCHAR(255) NULL,
    from_name       VARCHAR(255) NOT NULL,
    from_email      VARCHAR(255) NOT NULL,
    reply_to        VARCHAR(255) NULL,
    content_html    LONGTEXT NULL,
    content_text    TEXT NULL,
    template_id     BIGINT UNSIGNED NULL,
    status          ENUM('draft','scheduled','sending','sent','paused','cancelled','failed') DEFAULT 'draft',
    scheduled_at    TIMESTAMP NULL,
    sent_at         TIMESTAMP NULL,
    estimated_recipients INT UNSIGNED NULL,
    actual_recipients    INT UNSIGNED NULL,
    created_by      BIGINT UNSIGNED NOT NULL,
    created_at      TIMESTAMP NULL,
    updated_at      TIMESTAMP NULL,
    deleted_at      TIMESTAMP NULL
);
```

**Índices:**
```sql
INDEX idx_campaigns_brand (brand_id)
INDEX idx_campaigns_brand_status (brand_id, status)
INDEX idx_campaigns_scheduled (brand_id, status, scheduled_at)
INDEX idx_campaigns_created_by (created_by)
```

---

### `campaign_lists`
**Objetivo:** Relação muitos-para-muitos entre campanhas e listas/segmentos.

```sql
CREATE TABLE campaign_lists (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    campaign_id     BIGINT UNSIGNED NOT NULL,
    list_id         BIGINT UNSIGNED NULL,
    segment_id      BIGINT UNSIGNED NULL,
    is_exclusion    BOOLEAN DEFAULT FALSE,         -- TRUE = excluir estes contactos
    INDEX idx_camp_lists_campaign (campaign_id)
);
```

---

### `campaign_recipients`
**Objetivo:** Registo de cada destinatário de uma campanha. Gerado no momento do envio.

```sql
CREATE TABLE campaign_recipients (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    campaign_id     BIGINT UNSIGNED NOT NULL,
    brand_id        BIGINT UNSIGNED NOT NULL,      -- desnormalizado para performance
    contact_id      BIGINT UNSIGNED NOT NULL,
    email           VARCHAR(320) NOT NULL,          -- cópia do email no momento do envio
    status          ENUM('pending','sent','bounced','failed') DEFAULT 'pending',
    message_id      VARCHAR(255) NULL,              -- ID do provider de envio
    sent_at         TIMESTAMP NULL,
    created_at      TIMESTAMP NULL,
    INDEX idx_cr_campaign (campaign_id),
    INDEX idx_cr_brand_campaign (brand_id, campaign_id),
    INDEX idx_cr_contact (contact_id),
    INDEX idx_cr_status (campaign_id, status),
    INDEX idx_cr_message_id (message_id)
) PARTITION BY HASH(campaign_id) PARTITIONS 16;
```

> **Nota:** Esta tabela pode ter muitos milhões de linhas. Particionamento por `campaign_id` garante que queries por campanha são rápidas.

---

### `templates`
**Objetivo:** Templates de email reutilizáveis.

```sql
CREATE TABLE templates (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    brand_id        BIGINT UNSIGNED NULL,          -- NULL = template partilhado (global)
    name            VARCHAR(255) NOT NULL,
    description     TEXT NULL,
    content_html    LONGTEXT NOT NULL,
    content_text    TEXT NULL,
    thumbnail_path  VARCHAR(500) NULL,
    is_shared       BOOLEAN DEFAULT FALSE,
    created_by      BIGINT UNSIGNED NULL,
    created_at      TIMESTAMP NULL,
    updated_at      TIMESTAMP NULL,
    deleted_at      TIMESTAMP NULL
);
```

**Índices:**
```sql
INDEX idx_templates_brand (brand_id)
INDEX idx_templates_shared (is_shared)
```

---

### `email_events`
**Objetivo:** Registo de todos os eventos de email (abertura, clique, bounce, etc.).

```sql
CREATE TABLE email_events (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    campaign_id     BIGINT UNSIGNED NOT NULL,
    brand_id        BIGINT UNSIGNED NOT NULL,
    contact_id      BIGINT UNSIGNED NULL,
    email           VARCHAR(320) NOT NULL,
    event_type      ENUM('open','click','bounce','unsubscribe','spam_complaint','delivered') NOT NULL,
    event_data      JSON NULL,                     -- URL clicada, bounce reason, etc.
    ip_address      VARCHAR(45) NULL,
    user_agent      VARCHAR(500) NULL,
    occurred_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_ee_campaign (campaign_id),
    INDEX idx_ee_brand_campaign (brand_id, campaign_id),
    INDEX idx_ee_contact_type (contact_id, event_type),
    INDEX idx_ee_type_occurred (event_type, occurred_at),
    INDEX idx_ee_brand_type (brand_id, event_type)
) PARTITION BY RANGE (UNIX_TIMESTAMP(occurred_at)) (
    PARTITION p_2026_q1 VALUES LESS THAN (UNIX_TIMESTAMP('2026-04-01')),
    PARTITION p_2026_q2 VALUES LESS THAN (UNIX_TIMESTAMP('2026-07-01')),
    PARTITION p_2026_q3 VALUES LESS THAN (UNIX_TIMESTAMP('2026-10-01')),
    PARTITION p_2026_q4 VALUES LESS THAN (UNIX_TIMESTAMP('2027-01-01')),
    PARTITION p_future VALUES LESS THAN MAXVALUE
);
```

> **Nota:** Particionamento por data permite DROP de partições antigas de forma eficiente e queries temporais rápidas.

---

### `unsubscribes`
**Objetivo:** Registo definitivo de unsubscribes.

```sql
CREATE TABLE unsubscribes (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    brand_id        BIGINT UNSIGNED NOT NULL,
    contact_id      BIGINT UNSIGNED NULL,
    email           VARCHAR(320) NOT NULL,
    campaign_id     BIGINT UNSIGNED NULL,
    source          ENUM('link','manual','import','api','bounce','spam_complaint') NOT NULL,
    ip_address      VARCHAR(45) NULL,
    unsubscribed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_brand_email (brand_id, email),
    INDEX idx_unsub_brand (brand_id),
    INDEX idx_unsub_contact (contact_id),
    INDEX idx_unsub_date (brand_id, unsubscribed_at)
);
```

---

### `suppression_list`
**Objetivo:** Lista de supressão por marca — emails que nunca devem receber campanhas.

```sql
CREATE TABLE suppression_list (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    brand_id        BIGINT UNSIGNED NOT NULL,
    email           VARCHAR(320) NOT NULL,
    email_hash      CHAR(64) NOT NULL,
    reason          ENUM('unsubscribe','hard_bounce','spam_complaint','manual','import') NOT NULL,
    added_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    added_by        BIGINT UNSIGNED NULL,
    UNIQUE KEY unique_brand_suppression (brand_id, email_hash),
    INDEX idx_supp_brand (brand_id),
    INDEX idx_supp_hash (email_hash)
);
```

---

### `login_sessions`
**Objetivo:** Rastreamento de sessões de login ativas.

```sql
CREATE TABLE login_sessions (
    id              VARCHAR(100) PRIMARY KEY,      -- session ID
    user_id         BIGINT UNSIGNED NOT NULL,
    ip_address      VARCHAR(45) NOT NULL,
    user_agent      TEXT NULL,
    device_type     VARCHAR(50) NULL,              -- 'desktop', 'mobile', 'tablet'
    location        VARCHAR(255) NULL,              -- GeoIP aproximado
    last_activity   TIMESTAMP NOT NULL,
    created_at      TIMESTAMP NULL,
    INDEX idx_ls_user (user_id),
    INDEX idx_ls_activity (last_activity)
);
```

---

### `audit_logs`
**Objetivo:** Registo imutável de ações relevantes para auditoria e RGPD.

```sql
CREATE TABLE audit_logs (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id         BIGINT UNSIGNED NULL,
    brand_id        BIGINT UNSIGNED NULL,
    action          VARCHAR(100) NOT NULL,          -- 'campaign.sent', 'contact.deleted', etc.
    entity_type     VARCHAR(100) NULL,              -- 'Campaign', 'Contact', 'User'
    entity_id       BIGINT UNSIGNED NULL,
    old_values      JSON NULL,
    new_values      JSON NULL,
    ip_address      VARCHAR(45) NULL,
    user_agent      VARCHAR(500) NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_al_user (user_id),
    INDEX idx_al_brand (brand_id),
    INDEX idx_al_action (action),
    INDEX idx_al_entity (entity_type, entity_id),
    INDEX idx_al_created (created_at)
) PARTITION BY RANGE (UNIX_TIMESTAMP(created_at)) (
    PARTITION p_2026_q1 VALUES LESS THAN (UNIX_TIMESTAMP('2026-04-01')),
    PARTITION p_2026_q2 VALUES LESS THAN (UNIX_TIMESTAMP('2026-07-01')),
    PARTITION p_future VALUES LESS THAN MAXVALUE
);
```

---

## 5.3 Diagrama de Relações Simplificado

```
brands (1) ──── (N) user_brand_roles (N) ──── (1) users
  │                                                  │
  │                                            login_sessions
  │
  ├── (N) contact_lists (1) ──── (N) contact_list_members (N) ──── (1) contacts
  │                                         │                              │
  │                                      imports                   contact_brand_relations
  │                                                                contact_tag_relations ─── tags
  │
  ├── (N) campaigns (1) ──── (N) campaign_lists
  │           │
  │           ├── (N) campaign_recipients (N) ──── (1) contacts
  │           └── (N) email_events
  │
  ├── (N) templates
  ├── (N) unsubscribes
  ├── (N) suppression_list
  └── (N) audit_logs
```

---

## 5.4 Gestão do "Direito ao Esquecimento" (RGPD)

Quando um contacto pede para ser esquecido:

1. `contacts.first_name`, `last_name`, `phone`, `company` → substituídos por `[REMOVED]`
2. `contacts.email` → substituído por hash irreversível (ou anonimizado)
3. `contact_list_members.custom_fields` → limpos
4. `contact_brand_relations.consent_source` → limpo
5. `unsubscribes` e `suppression_list` → mantêm apenas o hash do email (sem dados pessoais) para garantir que o contacto não volta a receber emails
6. `email_events` → `email` substituído por `[REMOVED]`
7. `audit_logs` → registo da ação de "direito ao esquecimento" adicionado, dados pessoais removidos
8. Ficheiros importados no S3 com dados do contacto → deleção programada

Este processo é registado num `audit_log` com `action = 'gdpr.erasure_request'`.

---

*Próximo: [06 — Estratégia de Performance](06-performance-strategy.md)*
