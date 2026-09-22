-- Porque é que um envio parou a meio?
--
-- Correr no Supabase → SQL Editor, de cima para baixo. Cada consulta tem, por
-- baixo, o que esperar e o que concluir.
--
-- A causa mais comum NÃO é a plataforma: é o agendador externo não estar a
-- chamar /api/cron com frequência suficiente. Cada invocação do cron faz, por
-- desenho, no máximo UM lote (500 por omissão, SES_BATCH_SIZE) — a função tem
-- 50 s de orçamento e só arranca outro lote se lhe restarem 30 s. Um envio
-- parado num múltiplo exacto de 500 é quase sempre isso.


-- ── 1. O agendador está vivo, e com que frequência? ───────────────────────
SELECT last_run_at,
       NOW() - last_run_at         AS ha_quanto_tempo,
       elapsed_ms,
       processed                   AS campanhas_na_ultima_passagem
  FROM cron_heartbeat;

-- ha_quanto_tempo abaixo de 1-2 min  → o agendador está a correr ao minuto.
--                 acima de 5 min      → corre demasiado espaçado, ou parou.
--                 em 1970             → nunca chegou ao fim de uma passagem.
--
-- ATENÇÃO a um caso enganador: o pulso é gravado NO FIM da passagem. Se a
-- função estiver a ser morta pela Vercel aos 60 s, o cron está a correr mas o
-- pulso nunca é escrito. Distingue-se pelos logs: se houver linhas de envio
-- sem o pulso a actualizar, é morte por tempo, não ausência de agendador.


-- ── 2. Em que estado estão os destinatários das campanhas paradas? ────────
SELECT c.id,
       c.name,
       c.status::text                                            AS campanha,
       COUNT(*)                                                  AS total,
       COUNT(*) FILTER (WHERE cr.status = 'pending')             AS por_enviar,
       COUNT(*) FILTER (WHERE cr.status = 'retry')               AS a_repetir,
       COUNT(*) FILTER (WHERE cr.status = 'sending')             AS reclamados,
       COUNT(*) FILTER (WHERE cr.status = 'sent')                AS enviados,
       COUNT(*) FILTER (WHERE cr.status = 'failed')              AS falhados,
       COUNT(*) FILTER (WHERE cr.status = 'suppressed')          AS suprimidos,
       MAX(COALESCE(cr.attempted_at, cr.sent_at))                AS ultima_actividade,
       NOW() - MAX(COALESCE(cr.attempted_at, cr.sent_at))        AS parado_ha
  FROM campaigns c
  JOIN campaign_recipients cr ON cr.campaign_id = c.id
 WHERE c.status = 'sending'
 GROUP BY c.id, c.name, c.status
 ORDER BY c.id DESC;

-- por_enviar alto e parado_ha grande  → há trabalho e ninguém a fazê-lo:
--                                        confirma o diagnóstico do ponto 1.
-- reclamados alto e parado_ha grande  → linhas presas em 'sending'. São
--                                        recuperadas ao fim de 2 min pelo
--                                        próprio motor; se persistirem, ver 3.
-- por_enviar = 0 e a campanha em 'sending' → não falta ninguém; a campanha é
--                                        fechada na passagem seguinte do cron.


-- ── 3. Há linhas presas? ──────────────────────────────────────────────────
-- Uma linha em 'sending' foi reclamada por um trabalhador. Se já foi entregue
-- ao SES tem dispatched_at preenchido e NÃO deve ser reenviada (duplicaria).
-- Se não foi, é recuperada 2 minutos depois da reivindicação.
SELECT campaign_id,
       COUNT(*)                                          AS em_sending,
       COUNT(*) FILTER (WHERE dispatched_at IS NOT NULL) AS ja_entregues_ao_ses,
       COUNT(*) FILTER (WHERE dispatched_at IS NULL)     AS recuperaveis,
       MIN(attempted_at)                                 AS reclamada_ha_mais_tempo
  FROM campaign_recipients
 WHERE status = 'sending'
 GROUP BY campaign_id;

-- ja_entregues_ao_ses > 0  → esses emails SAÍRAM. A gravação do estado é que
--                            falhou. Não reenviar: contam como enviados.
-- recuperaveis > 0 com reclamada_ha_mais_tempo acima de 2 min → o motor
--                            recupera-as sozinho na passagem seguinte.


-- ── 4. Foi a quota do SES? ────────────────────────────────────────────────
-- A quota não deixa rasto na base de dados: deixa-o nos LOGS da Vercel, na
-- função api/campaigns. Procurar a linha:
--
--     Campaign <id>: limite diário atingido (...). N destinatários ficam
--     pendentes até à reposição.
--
-- Se aparecer, não é problema nenhum: o envio retoma quando a quota repuser,
-- à meia-noite UTC. O número de enviados no ponto 2 seria um valor arbitrário,
-- não um múltiplo exacto de 500.


-- ── 5. Ritmo real do envio ────────────────────────────────────────────────
-- Quantos emails saíram por minuto, na última hora. Mostra se o envio está a
-- correr devagar ou se está mesmo parado, e com que espaçamento.
SELECT date_trunc('minute', sent_at) AS minuto,
       COUNT(*)                      AS enviados
  FROM campaign_recipients
 WHERE sent_at > NOW() - INTERVAL '1 hour'
 GROUP BY 1
 ORDER BY 1 DESC
 LIMIT 30;

-- Blocos de ~500 separados por muitos minutos → cada bloco é uma invocação do
-- cron. O espaçamento entre eles É o intervalo do agendador externo.
