-- Migration 036: indexes for suppression checks at send time

-- runBatch/send_batch compare lower(suppression.email) = lower(campaign_recipients.email)
CREATE INDEX IF NOT EXISTS idx_suppression_email_lower
  ON suppression (lower(email));

-- pending/retry recipient scans per campaign (batch picking + suppression purge)
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_campaign_status
  ON campaign_recipients (campaign_id, status);

-- functional lookup used by the suppression purge on the recipient side
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_email_lower
  ON campaign_recipients (lower(email));
