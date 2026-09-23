-- Índices por contact_id nas duas tabelas que um apagamento de contactos atravessa.
--
-- Apagar um contacto não é uma escrita: é uma por cada tabela que o
-- referencia. campaign_recipients tem ON DELETE CASCADE e email_events tem uma
-- chave estrangeira que o Postgres verifica a cada linha apagada. As duas
-- procuram pelo contact_id — e NENHUMA das duas tinha índice nessa coluna:
--
--   • campaign_recipients só tinha índices a começar por campaign_id
--     (incluindo o UNIQUE (campaign_id, contact_id), que não serve uma procura
--     só por contact_id);
--   • email_events não tinha nenhum.
--
-- Sem eles, cada contacto apagado obrigava a ler as duas maiores tabelas do
-- sistema de ponta a ponta. Esvaziar a lista Marketing eram milhares dessas
-- leituras dentro de uma única transacção — batia no limite de 20 s por
-- consulta, era revertida, e não ficava nada apagado.
--
-- NOTA DE OPERAÇÃO: como a 065, correr fora de um envio a decorrer. Um CREATE
-- INDEX normal bloqueia as ESCRITAS na tabela enquanto constrói. Para zero
-- bloqueio, correr cada um à parte com CREATE INDEX CONCURRENTLY (não pode ser
-- dentro de uma transacção).

CREATE INDEX IF NOT EXISTS idx_campaign_recipients_contact
  ON campaign_recipients (contact_id);

CREATE INDEX IF NOT EXISTS idx_email_events_contact
  ON email_events (contact_id);

-- ── Verificação ────────────────────────────────────────────────────────────
-- Devem aparecer os dois:
--
--   SELECT tablename, indexname FROM pg_indexes
--    WHERE indexname IN ('idx_campaign_recipients_contact','idx_email_events_contact');
