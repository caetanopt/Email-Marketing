-- Campos adicionais por lista: definições e valores por membro

ALTER TABLE lists
  ADD COLUMN IF NOT EXISTS extra_fields JSONB DEFAULT '[]'::jsonb;

ALTER TABLE list_members
  ADD COLUMN IF NOT EXISTS extra_data JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN lists.extra_fields IS 'Array of {name,type} field definitions for this list';
COMMENT ON COLUMN list_members.extra_data IS 'Key/value map of extra field values for this contact in this list';
