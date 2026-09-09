-- S-5: limitar o ritmo de pedidos em endpoints públicos.
--
-- Sem isto, o pedido de link mágico (POST /api/auth) aceita chamadas sem
-- limite: qualquer pessoa que saiba um email de utilizador pode disparar
-- centenas de emails de acesso para a caixa dessa pessoa (mailbombing) e
-- queimar a quota de SES. O mesmo para a API pública de sincronização.
--
-- Contador de janela fixa: uma linha por (balde, chave, início da janela).
-- O balde separa endpoints ('magic', 'sync'); a chave é o email ou o IP; a
-- janela é o instante arredondado ao tamanho da janela. Um índice único
-- deixa o INSERT ... ON CONFLICT incrementar de forma atómica, sem corrida
-- entre invocações serverless concorrentes.

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket       TEXT        NOT NULL,
  key          TEXT        NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  count        INT         NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, key, window_start)
);

-- As janelas velhas não servem para nada — um índice pelo início da janela
-- torna a limpeza periódica barata.
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits (window_start);
