-- Add purpose flags to domain whitelist
ALTER TABLE domain_whitelist
    ADD COLUMN IF NOT EXISTS use_sender BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS use_utm    BOOLEAN NOT NULL DEFAULT FALSE;
