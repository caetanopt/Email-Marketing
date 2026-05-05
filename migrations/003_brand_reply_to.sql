-- Adiciona coluna reply_to à tabela brands
ALTER TABLE brands ADD COLUMN IF NOT EXISTS reply_to TEXT;
