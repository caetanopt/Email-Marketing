-- Global domain whitelist for allowed sender/recipient domains
CREATE TABLE IF NOT EXISTS domain_whitelist (
  id         SERIAL PRIMARY KEY,
  domain     TEXT NOT NULL UNIQUE,
  note       TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_domain_whitelist_domain ON domain_whitelist(domain);
