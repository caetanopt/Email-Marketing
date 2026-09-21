-- Pulso do agendador.
--
-- Os envios agendados dependem de um agendador EXTERNO chamar /api/cron. Não
-- há Vercel Cron, nem workers, nem fila. Se esse agendador parar — conta
-- expirada, serviço em baixo, alguém que desactivou o job — nada nesta
-- plataforma dá por isso: as campanhas ficam em 'scheduled' para sempre e o
-- painel continua verde. O primeiro a reparar é o cliente que não recebeu.
--
-- Uma linha, reescrita a cada invocação. O que interessa é o last_run_at: se
-- envelhecer, o agendador morreu.
--
-- Escrever isto NUNCA pode travar o cron. Quem escreve trata o erro e segue.

CREATE TABLE IF NOT EXISTS cron_heartbeat (
  id          SMALLINT    PRIMARY KEY DEFAULT 1,
  last_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  elapsed_ms  INTEGER,
  processed   INTEGER,
  detalhe     JSONB,
  CONSTRAINT cron_heartbeat_linha_unica CHECK (id = 1)
);

-- Semente, para o painel distinguir "nunca correu" de "tabela acabada de
-- criar". Um last_run_at na época deixa o alarme aceso até o cron correr pela
-- primeira vez, que é exactamente o que se quer: o silêncio não é bom sinal.
INSERT INTO cron_heartbeat (id, last_run_at, processed)
VALUES (1, 'epoch', 0)
ON CONFLICT (id) DO NOTHING;

-- ── Verificação ────────────────────────────────────────────────────────────
--   SELECT last_run_at, NOW() - last_run_at AS ha_quanto_tempo, processed
--     FROM cron_heartbeat;
