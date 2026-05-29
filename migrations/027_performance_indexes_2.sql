-- Index for dashboard and stats queries filtering by campaign + event type + date
CREATE INDEX IF NOT EXISTS idx_email_events_campaign_type_created
  ON email_events(campaign_id, type, created_at DESC);

-- Partial index for click analytics (only rows with a URL)
CREATE INDEX IF NOT EXISTS idx_email_events_campaign_type_url
  ON email_events(campaign_id, type) WHERE url IS NOT NULL;

-- Index for per-contact event history queries
CREATE INDEX IF NOT EXISTS idx_email_events_contact_created
  ON email_events(contact_id, created_at DESC);

-- Index for pagination queries on campaign_recipients
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_campaign_id
  ON campaign_recipients(campaign_id, id DESC);
