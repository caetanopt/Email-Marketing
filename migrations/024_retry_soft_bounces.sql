-- Retry count for soft bounces (Transient/temporary delivery failures)
-- Soft bounces get up to 3 automatic retry attempts before being marked failed
ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS retry_count SMALLINT DEFAULT 0;

-- Index to pick up retry candidates quickly in send_batch
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_retry
  ON campaign_recipients(campaign_id, status)
  WHERE status = 'retry';
