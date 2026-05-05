-- PrimeMail — Schema PostgreSQL (Supabase)
-- Executar no Supabase: Project → SQL Editor → New Query → colar e Run

-- ── Marcas ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS brands (
  id         TEXT        PRIMARY KEY,
  name       TEXT        NOT NULL,
  color      TEXT        DEFAULT '#1C1C1C',
  logo_url   TEXT,
  from_name  TEXT,
  from_email TEXT,
  active     BOOLEAN     DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Utilizadores ────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL      PRIMARY KEY,
  name          TEXT        NOT NULL,
  email         TEXT        NOT NULL UNIQUE,
  password_hash TEXT        NOT NULL,
  active        BOOLEAN     DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  last_login    TIMESTAMPTZ
);

-- ── Roles por marca ──────────────────────────────────
CREATE TYPE user_role AS ENUM ('owner','admin','editor','viewer');

CREATE TABLE IF NOT EXISTS user_brand_roles (
  id         SERIAL      PRIMARY KEY,
  user_id    INT         NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  brand_id   TEXT        NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  role       user_role   NOT NULL DEFAULT 'viewer',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, brand_id)
);

-- ── Contactos ───────────────────────────────────────
CREATE TYPE contact_status AS ENUM ('active','unsubscribed','bounced','suppressed');

CREATE TABLE IF NOT EXISTS contacts (
  id                SERIAL        PRIMARY KEY,
  brand_id          TEXT          NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  email             TEXT          NOT NULL,
  name              TEXT,
  phone             TEXT,
  company           TEXT,
  status            contact_status DEFAULT 'active',
  source            TEXT,
  custom_attributes JSONB,
  created_at        TIMESTAMPTZ   DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   DEFAULT NOW(),
  UNIQUE (brand_id, email)
);
CREATE INDEX IF NOT EXISTS idx_contacts_brand_status ON contacts(brand_id, status);

-- ── Listas ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lists (
  id          SERIAL      PRIMARY KEY,
  brand_id    TEXT        NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lists_brand ON lists(brand_id);

-- ── Membros das listas ──────────────────────────────
CREATE TABLE IF NOT EXISTS list_members (
  list_id    INT         NOT NULL REFERENCES lists(id)    ON DELETE CASCADE,
  contact_id INT         NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  added_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (list_id, contact_id)
);

-- ── Templates ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS templates (
  id           SERIAL      PRIMARY KEY,
  brand_id     TEXT        NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  name         TEXT        NOT NULL,
  subject      TEXT,
  preview_text TEXT,
  html_content TEXT,
  created_by   INT         REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_templates_brand ON templates(brand_id);

-- ── Campanhas ───────────────────────────────────────
CREATE TYPE campaign_status AS ENUM ('draft','scheduled','sending','sent','paused','cancelled');

CREATE TABLE IF NOT EXISTS campaigns (
  id           SERIAL          PRIMARY KEY,
  brand_id     TEXT            NOT NULL REFERENCES brands(id)    ON DELETE CASCADE,
  name         TEXT            NOT NULL,
  subject      TEXT,
  preview_text TEXT,
  from_name    TEXT,
  from_email   TEXT,
  template_id  INT             REFERENCES templates(id) ON DELETE SET NULL,
  status       campaign_status DEFAULT 'draft',
  scheduled_at TIMESTAMPTZ,
  sent_at      TIMESTAMPTZ,
  created_by   INT             REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ     DEFAULT NOW(),
  updated_at   TIMESTAMPTZ     DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_campaigns_brand_status ON campaigns(brand_id, status);

-- ── Listas de cada campanha ──────────────────────────
CREATE TABLE IF NOT EXISTS campaign_lists (
  campaign_id INT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  list_id     INT NOT NULL REFERENCES lists(id)     ON DELETE CASCADE,
  PRIMARY KEY (campaign_id, list_id)
);

-- ── Destinatários ────────────────────────────────────
CREATE TYPE recipient_status AS ENUM ('pending','sent','failed','bounced','suppressed');

CREATE TABLE IF NOT EXISTS campaign_recipients (
  id          SERIAL           PRIMARY KEY,
  campaign_id INT              NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id  INT              NOT NULL REFERENCES contacts(id)  ON DELETE CASCADE,
  email       TEXT             NOT NULL,
  status      recipient_status DEFAULT 'pending',
  message_id  TEXT,
  sent_at     TIMESTAMPTZ,
  UNIQUE (campaign_id, contact_id)
);
CREATE INDEX IF NOT EXISTS idx_recipients_campaign ON campaign_recipients(campaign_id);

-- ── Eventos de email ────────────────────────────────
CREATE TYPE event_type AS ENUM ('delivered','open','click','bounce','unsubscribe','spam');

CREATE TABLE IF NOT EXISTS email_events (
  id          SERIAL      PRIMARY KEY,
  campaign_id INT         NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id  INT         REFERENCES contacts(id),
  email       TEXT,
  type        event_type  NOT NULL,
  url         TEXT,
  ip          TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_events_campaign_type ON email_events(campaign_id, type);

-- ── Supressão ───────────────────────────────────────
CREATE TYPE suppression_reason AS ENUM ('manual','bounce','unsubscribe','spam');

CREATE TABLE IF NOT EXISTS suppression (
  id         SERIAL             PRIMARY KEY,
  brand_id   TEXT               NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  email      TEXT               NOT NULL,
  reason     suppression_reason DEFAULT 'manual',
  created_at TIMESTAMPTZ        DEFAULT NOW(),
  UNIQUE (brand_id, email)
);
CREATE INDEX IF NOT EXISTS idx_suppression_email ON suppression(email);
