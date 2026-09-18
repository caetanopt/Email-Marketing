-- Idempotência do webhook de eventos.
--
-- O SNS entrega *pelo menos uma vez*: uma reentrega é normal, não é um ataque.
-- Nada no código a detectava.
--
-- O ramo de bounce transitório é o pior: incrementa retry_count. Uma reentrega
-- consome as tentativas de um destinatário que ainda as tinha, e à terceira
-- põe a linha em 'failed' — estado terminal que nenhuma consulta de
-- reivindicação selecciona. Isso é um envio perdido, não um número errado.
--
-- O INSERT de eventos também não tinha como deduplicar: o ON CONFLICT DO
-- NOTHING do ramo de queixa não tem alvo nenhum, e email_events não tem
-- restrição de unicidade (os índices das migrações 001, 009, 027 e 054 são
-- todos não-únicos), por isso nunca disparava. Os dois ramos duplicavam.
--
-- Guardar o MessageId do SNS resolve os dois de uma vez: o mesmo evento
-- entregue duas vezes é processado uma só.

CREATE TABLE IF NOT EXISTS webhook_events (
  sns_message_id TEXT PRIMARY KEY,
  tipo           TEXT,
  recebido_em    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Para a limpeza periódica: passados uns dias, uma reentrega já não acontece.
CREATE INDEX IF NOT EXISTS idx_webhook_events_recebido
  ON webhook_events (recebido_em);

COMMENT ON TABLE webhook_events IS
  'MessageId de cada notificação SNS já processada. O SNS entrega pelo menos uma vez; sem isto, uma reentrega contava duas vezes e consumia tentativas de envio.';
