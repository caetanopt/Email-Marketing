-- Minimização de dados (RGPD): remover a coluna email_events.ip.
--
-- A coluna foi declarada na 001 mas NUNCA é escrita nem lida em lado nenhum do
-- código (confirmado por pesquisa em api/ e lib/). Uma coluna de IP que existe
-- é um convite a ser preenchida por quem vier a seguir, e o IP é dado pessoal
-- que não é necessário para nenhuma funcionalidade actual. Remove-se em vez de
-- a deixar como campo latente.
--
-- Não perde nada: como nunca foi escrita, está toda a NULL. Idempotente.

ALTER TABLE email_events DROP COLUMN IF EXISTS ip;

-- Verificação (não deve devolver a linha 'ip'):
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'email_events' ORDER BY ordinal_position;
