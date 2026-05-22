-- Performance index for dashboard queries filtered by brand + status + date range
CREATE INDEX IF NOT EXISTS idx_campaigns_brand_status_sent_at
  ON campaigns(brand_id, status, sent_at DESC);

-- Index for email lookup in contacts (used in cross-brand suppression updates)
CREATE INDEX IF NOT EXISTS idx_contacts_email
  ON contacts(email);

-- Index for send log email queries
CREATE INDEX IF NOT EXISTS idx_send_log_email
  ON email_send_log(email);
