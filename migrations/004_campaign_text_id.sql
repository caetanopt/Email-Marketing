-- Migration 004: Change campaigns.id from SERIAL INT to TEXT (brand-timestamp format)
-- Run this once on the existing database.

BEGIN;

-- 1. Drop FK constraints that reference campaigns.id
ALTER TABLE campaign_lists      DROP CONSTRAINT IF EXISTS campaign_lists_campaign_id_fkey;
ALTER TABLE campaign_recipients DROP CONSTRAINT IF EXISTS campaign_recipients_campaign_id_fkey;
ALTER TABLE email_events        DROP CONSTRAINT IF EXISTS email_events_campaign_id_fkey;

-- 2. Add temporary text id columns in child tables
ALTER TABLE campaign_lists      ADD COLUMN campaign_id_new TEXT;
ALTER TABLE campaign_recipients ADD COLUMN campaign_id_new TEXT;
ALTER TABLE email_events        ADD COLUMN campaign_id_new TEXT;

-- 3. Convert existing integer ids to text in child tables
UPDATE campaign_lists      SET campaign_id_new = campaign_id::TEXT;
UPDATE campaign_recipients SET campaign_id_new = campaign_id::TEXT;
UPDATE email_events        SET campaign_id_new = campaign_id::TEXT;

-- 4. Drop old integer campaign_id columns in child tables
ALTER TABLE campaign_lists      DROP COLUMN campaign_id;
ALTER TABLE campaign_recipients DROP COLUMN campaign_id;
ALTER TABLE email_events        DROP COLUMN campaign_id;

-- 5. Rename new columns
ALTER TABLE campaign_lists      RENAME COLUMN campaign_id_new TO campaign_id;
ALTER TABLE campaign_recipients RENAME COLUMN campaign_id_new TO campaign_id;
ALTER TABLE email_events        RENAME COLUMN campaign_id_new TO campaign_id;

-- 6. Change campaigns.id from SERIAL to TEXT
ALTER TABLE campaigns ALTER COLUMN id DROP DEFAULT;
ALTER TABLE campaigns ALTER COLUMN id TYPE TEXT USING id::TEXT;

-- 7. Recreate FK constraints
ALTER TABLE campaign_lists
  ADD CONSTRAINT campaign_lists_campaign_id_fkey
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;

ALTER TABLE campaign_recipients
  ADD CONSTRAINT campaign_recipients_campaign_id_fkey
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;

ALTER TABLE email_events
  ADD CONSTRAINT email_events_campaign_id_fkey
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;

-- 8. Add NOT NULL back to child table campaign_id columns
ALTER TABLE campaign_lists      ALTER COLUMN campaign_id SET NOT NULL;
ALTER TABLE campaign_recipients ALTER COLUMN campaign_id SET NOT NULL;
ALTER TABLE email_events        ALTER COLUMN campaign_id SET NOT NULL;

COMMIT;
