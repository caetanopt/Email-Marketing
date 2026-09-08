-- Aberturas e cliques automáticos deixam de ser descartados.
--
-- O filtro de agentes corria no momento do pedido e o que não passava era
-- apagado. Quando surgiu a dúvida "as aberturas do Gmail estão a ser
-- contadas?", não havia como responder: a informação nunca tinha sido
-- guardada. Levou três hipóteses erradas e três dias.
--
-- Agora o evento é sempre registado, com o agente que o pediu e com um tipo
-- próprio quando é automático. Duas consequências:
--
--   - as consultas de métricas não mudam. Todas filtram type='open' ou
--     type='click', por isso passam a excluir os automáticos sem serem
--     tocadas — e são dezesseis. Uma coluna booleana obrigaria a alterar as
--     dezesseis e a nunca esquecer nenhuma;
--
--   - filtrar deixa de ser uma decisão irreversível tomada na escrita. Se um
--     filtro estiver errado (esteve, com o Gmail), os números passam a ser
--     recalculáveis em vez de perdidos.
--
-- Correr esta migração NÃO altera nenhum número existente.

-- 1. O agente que pediu o pixel ou seguiu o link.
--
-- Truncado a 200 caracteres na aplicação; sem IP. É dado pessoal, ao mesmo
-- nível do registo de abertura que já existia, e segue a mesma retenção.
ALTER TABLE email_events ADD COLUMN IF NOT EXISTS user_agent TEXT;

-- 2. Os dois tipos novos.
--
-- ADD VALUE IF NOT EXISTS é idempotente e não reescreve a tabela. Um valor de
-- enum não se pode remover depois, o que é a razão de serem só dois e de terem
-- nomes explícitos.
ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'open_auto';
ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'click_auto';

-- 3. Índice para as contagens por campanha e tipo.
--
-- As consultas do relatório filtram sempre por campanha e tipo; com os tipos
-- novos a tabela cresce (passa a guardar o que antes era descartado) e vale a
-- pena não voltar a percorrê-la toda.
CREATE INDEX IF NOT EXISTS email_events_campanha_tipo
  ON email_events (campaign_id, type);

-- Verificação (deve devolver as duas linhas novas e a coluna):
--   SELECT unnest(enum_range(NULL::event_type)) AS tipo;
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'email_events' AND column_name = 'user_agent';
