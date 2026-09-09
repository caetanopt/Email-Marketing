-- S-6: guardar as API keys como hash, não em texto claro.
--
-- As chaves (pm_… por marca, pmg_… global) estavam em texto claro em
-- brands.api_key e global_settings.global_api_key, e a API devolvia-as a
-- qualquer utilizador com acesso. Uma chave dá para consultar contactos por
-- email (dados pessoais). Passam a ser guardadas como SHA-256 e a nunca mais
-- ser devolvidas — só se vêem uma vez, no momento em que são geradas.
--
-- Não é preciso pgcrypto: a aplicação calcula o hash (a chave é 256 bits
-- aleatórios, não uma password — SHA-256 sem sal é o padrão para tokens).
--
-- As chaves ANTIGAS continuam a funcionar (a verificação aceita hash OU o
-- texto claro que ainda exista) até serem regeneradas. Regenerar passa-as a
-- hash e apaga o texto claro — e roda a chave, o que a auditoria já
-- recomendava. Idempotente.

ALTER TABLE brands          ADD COLUMN IF NOT EXISTS api_key_hash        TEXT;
ALTER TABLE global_settings ADD COLUMN IF NOT EXISTS global_api_key_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_brands_api_key_hash ON brands(api_key_hash);

-- Depois de regeneradas todas as chaves, o texto claro pode ser apagado de vez:
--   UPDATE brands SET api_key=NULL WHERE api_key_hash IS NOT NULL;
--   UPDATE global_settings SET global_api_key=NULL WHERE global_api_key_hash IS NOT NULL;
