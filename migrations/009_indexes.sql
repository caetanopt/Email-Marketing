-- Migration 009: Performance indexes
-- email_events filtered by (campaign_id, type) on every report fetch
CREATE INDEX IF NOT EXISTS idx_email_events_campaign_type ON email_events(campaign_id, type);
-- campaign_recipients aggregated by campaign on every report fetch
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_campaign ON campaign_recipients(campaign_id);
-- list_members joined by contact_id when listing contact memberships
CREATE INDEX IF NOT EXISTS idx_list_members_contact ON list_members(contact_id);
