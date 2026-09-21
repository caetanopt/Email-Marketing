-- Limpeza e reforço dos índices das tabelas que mais crescem.
--
-- NOTA DE OPERAÇÃO: correr fora de um envio a decorrer. Um CREATE INDEX
-- normal bloqueia as ESCRITAS na tabela enquanto constrói (segundos, nas
-- dimensões actuais). Se preferires zero bloqueio, corre cada CREATE à parte
-- com CREATE INDEX CONCURRENTLY — mas esse não pode correr dentro de uma
-- transacção, por isso tem de ser uma instrução de cada vez.

-- ── 1. Índices repetidos ───────────────────────────────────────────────────
--
-- email_events tem TRÊS índices idênticos sobre (campaign_id, type), criados
-- pelas migrações 001, 009 e 054 com nomes diferentes — ninguém reparou que
-- já existia. E existe um quarto, (campaign_id, type, created_at DESC), com o
-- mesmo prefixo: esse serve sozinho todas as consultas que os outros três
-- serviam, porque o Postgres usa um índice composto por qualquer prefixo das
-- suas colunas.
--
-- O custo não é o espaço: é que email_events é a tabela com mais escrita do
-- sistema — uma linha por abertura e por clique — e cada INSERT tinha de
-- actualizar quatro estruturas em vez de uma.
DROP INDEX IF EXISTS idx_events_campaign_type;        -- 001
DROP INDEX IF EXISTS idx_email_events_campaign_type;  -- 009
DROP INDEX IF EXISTS email_events_campanha_tipo;      -- 054

-- O mesmo em campaign_recipients: dois índices sobre (campaign_id), e um
-- terceiro sobre (campaign_id, id DESC) que os cobre aos dois.
DROP INDEX IF EXISTS idx_recipients_campaign;           -- 001
DROP INDEX IF EXISTS idx_campaign_recipients_campaign;  -- 009

-- ── 2. Índices em falta ────────────────────────────────────────────────────

-- O webhook de bounces e queixas passou a delimitar por message_id (ver a
-- migração 063 e a correcção que deixou de reescrever o histórico de todas as
-- campanhas). Sem índice, cada evento faz um varrimento completo de
-- campaign_recipients — a tabela que mais cresce.
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_message_id
  ON campaign_recipients (message_id)
  WHERE message_id IS NOT NULL;

-- O recurso do webhook, quando o messageId não casa, é por email. O único
-- índice que havia sobre essa coluna é funcional, sobre lower(email), e por
-- isso não serve um `WHERE email = $1`.
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_email
  ON campaign_recipients (email);

-- A limpeza de retenção e os três caminhos de apagamento de contactos
-- encontram as linhas do log por contact_id. A migração 013 criou índices por
-- marca, por campanha e por email — nunca por contact_id, que é exactamente a
-- coluna por onde o apagamento procura. Apagar um contacto varria o log todo.
CREATE INDEX IF NOT EXISTS idx_email_send_log_contact
  ON email_send_log (contact_id)
  WHERE contact_id IS NOT NULL;

-- A listagem de contactos ordena por created_at DESC e pagina com OFFSET.
-- Depois da migração 051 não restou nenhum índice que sirva essa ordenação:
-- cada página obrigava a ordenar a tabela inteira.
CREATE INDEX IF NOT EXISTS idx_contacts_created_at
  ON contacts (created_at DESC);

-- ── Verificação ────────────────────────────────────────────────────────────
-- Deve mostrar os índices de cada tabela, já sem os repetidos:
--
--   SELECT tablename, indexname FROM pg_indexes
--    WHERE tablename IN ('email_events','campaign_recipients','email_send_log','contacts')
--    ORDER BY tablename, indexname;
