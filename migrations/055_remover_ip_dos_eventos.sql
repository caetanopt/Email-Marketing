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

-- Pela mesma razão: email_events.email. O evento já liga a contact_id; guardar
-- também o email é uma segunda cópia do dado pessoal que nunca é escrita nem
-- lida (confirmado por pesquisa a INSERT/SELECT em api/). Remove-se.
ALTER TABLE email_events DROP COLUMN IF EXISTS email;

-- Verificação (não deve devolver as linhas 'ip' nem 'email'):
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'email_events' ORDER BY ordinal_position;
