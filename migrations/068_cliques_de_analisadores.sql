-- Cliques de analisadores de segurança que se fazem passar por browser.
--
-- Os cliques eram classificados só pelo agente (AGENTE_AUTOMATICO em
-- api/track.js), que apanha quem se identifica. O Defender for Office 365
-- (Safe Links), o Proofpoint e o Mimecast seguem os links com um agente de
-- Chrome normal: ficavam gravados como 'click' e entravam nas taxas. Na
-- campanha 131, 18 contactos tinham exactamente um clique em cada um dos 8
-- links, incluindo a política de privacidade, a versão web e as cinco redes
-- sociais.
--
-- Passam a ser classificados pelo comportamento (lib/classificarCliques.js):
-- o agendador revê cada campanha 10 min depois de o envio terminar e outra vez
-- 24 h depois. Esta migração só cria as colunas de que isso precisa.
--
-- CORRER ESTA MIGRAÇÃO NÃO MUDA NENHUM NÚMERO. As campanhas já enviadas ficam
-- dadas como revistas, por isso o deploy também não lhes toca. Corrigi-las é
-- uma escolha: scripts/reclassificar-cliques.sql mostra primeiro o efeito
-- (pré-visualização) e depois põe na fila as que se quiser.
--
-- Pode correr com envios a decorrer: as colunas não têm valor por omissão,
-- por isso não reescrevem as tabelas; precisam só de um bloqueio de um
-- instante. Se falhar com "lock timeout", correr outra vez. Correr outra vez
-- depois de ter posto campanhas na fila não as tira da fila.

SET lock_timeout = '5s';

-- A regra que marcou o evento.
ALTER TABLE email_events ADD COLUMN IF NOT EXISTS auto_reason TEXT;

-- Quando a campanha foi revista pela última vez. As já enviadas ficam como
-- revistas, só na primeira vez que a coluna é criada.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'campaigns' AND column_name = 'cliques_revistos_em') THEN
    ALTER TABLE campaigns ADD COLUMN cliques_revistos_em TIMESTAMPTZ;
    UPDATE campaigns SET cliques_revistos_em = NOW() WHERE status::text = 'sent';
  END IF;
END $$;

-- Quando foi tentada pela última vez (uma que falhe vai para o fim da fila).
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS cliques_tentado_em TIMESTAMPTZ;

RESET lock_timeout;

COMMENT ON COLUMN email_events.auto_reason IS
  'Regra de comportamento que marcou o evento como automático (rajada, varrimento, instantaneo). Vazio = não automático, ou marcado pelo agente no momento do registo.';
COMMENT ON COLUMN campaigns.cliques_revistos_em IS
  'Última revisão dos cliques automáticos (lib/classificarCliques.js). Vazio = por rever: o agendador revê-a na próxima passagem.';

-- Verificação:
--   SELECT column_name FROM information_schema.columns
--    WHERE (table_name, column_name) IN (('email_events','auto_reason'),('campaigns','cliques_revistos_em'),('campaigns','cliques_tentado_em'));
