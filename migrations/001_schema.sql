-- PrimeMail — Schema inicial
-- Executar no MariaDB: mysql -u claude -p email_apps < migrations/001_schema.sql

SET FOREIGN_KEY_CHECKS = 0;

-- ── Marcas ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS brands (
  id          VARCHAR(50)  PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  color       VARCHAR(7)   DEFAULT '#1C1C1C',
  logo_url    VARCHAR(500),
  from_name   VARCHAR(100),
  from_email  VARCHAR(255),
  active      TINYINT(1)   DEFAULT 1,
  created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Utilizadores ────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            INT          AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  active        TINYINT(1)   DEFAULT 1,
  created_at    DATETIME     DEFAULT CURRENT_TIMESTAMP,
  last_login    DATETIME     NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Roles por marca ──────────────────────────────────
CREATE TABLE IF NOT EXISTS user_brand_roles (
  id         INT         AUTO_INCREMENT PRIMARY KEY,
  user_id    INT         NOT NULL,
  brand_id   VARCHAR(50) NOT NULL,
  role       ENUM('owner','admin','editor','viewer') NOT NULL DEFAULT 'viewer',
  created_at DATETIME    DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_brand (user_id, brand_id),
  FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE CASCADE,
  FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Contactos ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS contacts (
  id                INT          AUTO_INCREMENT PRIMARY KEY,
  brand_id          VARCHAR(50)  NOT NULL,
  email             VARCHAR(255) NOT NULL,
  name              VARCHAR(100),
  phone             VARCHAR(50),
  company           VARCHAR(100),
  status            ENUM('active','unsubscribed','bounced','suppressed') DEFAULT 'active',
  source            VARCHAR(50),
  custom_attributes JSON,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_brand_email (brand_id, email),
  FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE,
  INDEX idx_brand_status (brand_id, status),
  INDEX idx_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Listas ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lists (
  id          INT          AUTO_INCREMENT PRIMARY KEY,
  brand_id    VARCHAR(50)  NOT NULL,
  name        VARCHAR(100) NOT NULL,
  description TEXT,
  created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE,
  INDEX idx_brand (brand_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Membros das listas ──────────────────────────────
CREATE TABLE IF NOT EXISTS list_members (
  list_id    INT      NOT NULL,
  contact_id INT      NOT NULL,
  added_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (list_id, contact_id),
  FOREIGN KEY (list_id)    REFERENCES lists(id)    ON DELETE CASCADE,
  FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Templates ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS templates (
  id           INT          AUTO_INCREMENT PRIMARY KEY,
  brand_id     VARCHAR(50)  NOT NULL,
  name         VARCHAR(100) NOT NULL,
  subject      VARCHAR(255),
  preview_text VARCHAR(255),
  html_content LONGTEXT,
  created_by   INT,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (brand_id)   REFERENCES brands(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id)  ON DELETE SET NULL,
  INDEX idx_brand (brand_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Campanhas ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS campaigns (
  id           INT          AUTO_INCREMENT PRIMARY KEY,
  brand_id     VARCHAR(50)  NOT NULL,
  name         VARCHAR(100) NOT NULL,
  subject      VARCHAR(255),
  preview_text VARCHAR(255),
  from_name    VARCHAR(100),
  from_email   VARCHAR(255),
  template_id  INT,
  status       ENUM('draft','scheduled','sending','sent','paused','cancelled') DEFAULT 'draft',
  scheduled_at DATETIME NULL,
  sent_at      DATETIME NULL,
  created_by   INT,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (brand_id)    REFERENCES brands(id)    ON DELETE CASCADE,
  FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by)  REFERENCES users(id)     ON DELETE SET NULL,
  INDEX idx_brand_status (brand_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Listas de cada campanha ──────────────────────────
CREATE TABLE IF NOT EXISTS campaign_lists (
  campaign_id INT NOT NULL,
  list_id     INT NOT NULL,
  PRIMARY KEY (campaign_id, list_id),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (list_id)     REFERENCES lists(id)     ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Destinatários (registo por envio) ───────────────
CREATE TABLE IF NOT EXISTS campaign_recipients (
  id          INT          AUTO_INCREMENT PRIMARY KEY,
  campaign_id INT          NOT NULL,
  contact_id  INT          NOT NULL,
  email       VARCHAR(255) NOT NULL,
  status      ENUM('pending','sent','failed','bounced','suppressed') DEFAULT 'pending',
  message_id  VARCHAR(255),
  sent_at     DATETIME NULL,
  UNIQUE KEY uq_campaign_contact (campaign_id, contact_id),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id)  REFERENCES contacts(id)  ON DELETE CASCADE,
  INDEX idx_campaign (campaign_id),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Eventos de email ────────────────────────────────
CREATE TABLE IF NOT EXISTS email_events (
  id          INT          AUTO_INCREMENT PRIMARY KEY,
  campaign_id INT          NOT NULL,
  contact_id  INT,
  email       VARCHAR(255),
  type        ENUM('delivered','open','click','bounce','unsubscribe','spam') NOT NULL,
  url         VARCHAR(500),
  ip          VARCHAR(45),
  user_agent  VARCHAR(500),
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  INDEX idx_campaign_type (campaign_id, type),
  INDEX idx_contact (contact_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Supressão ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS suppression (
  id         INT          AUTO_INCREMENT PRIMARY KEY,
  brand_id   VARCHAR(50)  NOT NULL,
  email      VARCHAR(255) NOT NULL,
  reason     ENUM('manual','bounce','unsubscribe','spam') DEFAULT 'manual',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_brand_email (brand_id, email),
  FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE,
  INDEX idx_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;
