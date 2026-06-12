-- Suporte a anexos em campanhas de email
-- Cada anexo é { name: string, type: string, data: string (base64) }
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;
