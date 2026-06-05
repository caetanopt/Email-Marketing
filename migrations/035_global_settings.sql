-- Singleton table for global typography / layout defaults
CREATE TABLE IF NOT EXISTS global_settings (
  id          INTEGER PRIMARY KEY DEFAULT 1,
  font_size   TEXT NOT NULL DEFAULT '14px',
  font_family TEXT NOT NULL DEFAULT 'Arial, sans-serif',
  line_height TEXT NOT NULL DEFAULT '1.6',
  email_width TEXT NOT NULL DEFAULT '600px',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT global_settings_singleton CHECK (id = 1)
);

INSERT INTO global_settings (id, font_size, font_family, line_height, email_width)
VALUES (1, '14px', 'Arial, sans-serif', '1.6', '600px')
ON CONFLICT DO NOTHING;
