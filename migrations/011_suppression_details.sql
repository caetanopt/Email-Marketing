-- Migration 011: Optional free-form reason captured from the unsubscribe form.
-- The existing `reason` column is an enum (manual/bounce/unsubscribe/spam) and
-- stays the technical reason; `details` carries whatever the user typed/picked.
ALTER TABLE suppression ADD COLUMN IF NOT EXISTS details TEXT;
