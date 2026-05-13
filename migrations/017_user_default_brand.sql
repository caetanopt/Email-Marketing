-- Default brand per user
ALTER TABLE users ADD COLUMN IF NOT EXISTS default_brand_id INTEGER REFERENCES brands(id) ON DELETE SET NULL;
