-- Desfaz a classificação de cliques e aberturas automáticos pelo comportamento
-- (lib/classificarCliques.js).
--
-- Só toca nos eventos que essas regras marcaram (auto_reason preenchido). Os
-- marcados pelo agente no momento do registo (auto_reason vazio) já eram
-- automáticos antes e ficam como estão.
--
-- ORDEM
--   1. Pedir a remoção do código desta funcionalidade (lib/classificarCliques.js
--      e a chamada no agendador, em api/campaigns/index.js) e esperar o
--      deploy. Sem isso, o agendador volta a marcar as campanhas que ainda
--      tenha por rever.
--   2. Correr o bloco abaixo. Mostra, por campanha, o que foi reposto.
--   3. Opcional, só depois do passo 1: apagar as colunas.

WITH reposto AS (
  UPDATE email_events
     SET type = (CASE type WHEN 'click_auto' THEN 'click' ELSE 'open' END)::event_type,
         auto_reason = NULL
   WHERE auto_reason IN ('rajada', 'varrimento', 'instantaneo')
     AND type IN ('click_auto', 'open_auto')
  RETURNING campaign_id, type
)
SELECT campaign_id, type::text AS reposto_como, COUNT(*) AS eventos
  FROM reposto
 GROUP BY 1, 2
 ORDER BY 1, 2;

-- 3. (opcional)
-- SET lock_timeout = '5s';
-- ALTER TABLE email_events DROP COLUMN IF EXISTS auto_reason;
-- ALTER TABLE campaigns DROP COLUMN IF EXISTS cliques_revistos_em;
-- ALTER TABLE campaigns DROP COLUMN IF EXISTS cliques_tentado_em;
-- RESET lock_timeout;

-- Verificação (deve dar zero):
--   SELECT COUNT(*) FROM email_events WHERE auto_reason IS NOT NULL;
