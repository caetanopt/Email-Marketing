-- API key per brand for external contact sync
ALTER TABLE brands ADD COLUMN IF NOT EXISTS api_key TEXT UNIQUE;
