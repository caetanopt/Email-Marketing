-- Chave da API de estatísticas (lib/analytics.js, rotas /api/analytics/*).
--
-- Uma chave só de leitura para ferramentas de fora (Power BI, Looker Studio,
-- Google Sheets…) lerem os números das campanhas de todas as marcas. É
-- separada da chave de sincronização, que escreve contactos. Guarda-se só o
-- hash SHA-256, como as outras (migração 056): a chave vê-se uma vez, quando é
-- gerada em Definições gerais.
--
-- Opcional: gerar a chave pela primeira vez cria estas colunas, se faltarem.
-- Não mexe em dados. Idempotente.

SET lock_timeout = '5s';

ALTER TABLE global_settings ADD COLUMN IF NOT EXISTS analytics_api_key_hash TEXT;
ALTER TABLE global_settings ADD COLUMN IF NOT EXISTS analytics_api_key_created_at TIMESTAMPTZ;

RESET lock_timeout;

COMMENT ON COLUMN global_settings.analytics_api_key_hash IS
  'SHA-256 da chave da API de estatísticas (pma_…), só leitura. Vazio = sem chave (a API recusa todos os pedidos).';
