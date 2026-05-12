-- Add UTM tracking parameters to campaigns
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS utm_params JSONB;
