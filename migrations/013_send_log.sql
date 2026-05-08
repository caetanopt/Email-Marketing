-- Migration 013: Email send log
-- Captures per-recipient errors and a global event log for sends/tests.
ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS attempted_at  TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS email_send_log (
    id          SERIAL PRIMARY KEY,
    brand_id    TEXT REFERENCES brands(id) ON DELETE CASCADE,
    campaign_id INT  REFERENCES campaigns(id) ON DELETE SET NULL,
    contact_id  INT  REFERENCES contacts(id)  ON DELETE SET NULL,
    email       TEXT NOT NULL,
    event_type  TEXT NOT NULL, -- sent | failed | test_sent | test_failed | campaign_started | campaign_completed
    message_id  TEXT,
    error       TEXT,
    created_by  INT  REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_send_log_brand    ON email_send_log(brand_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_send_log_campaign ON email_send_log(campaign_id, created_at DESC);
