-- Diagnóstico de uma campanha: o que foi enviado, a quem, e o que falta.
--
-- Só lê. Não altera nada. Substitui o 80 pelo id da campanha em causa.
--
-- Serve para responder à pergunta "isto foi enviado a alguém?" quando o
-- browser perdeu a ligação a meio do envio: o browser é só o que dá o
-- arranque aos lotes, e a resposta verdadeira está nestas tabelas.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Estado da campanha
--
-- status='sending' com pendentes = o cron vai continuar a enviar.
-- status='sent' = terminou. status='draft' = foi revertida por não ter
-- destinatários activos.
-- ───────────────────────────────────────────────────────────────────────────
SELECT id, name, subject, status, created_at, sent_at
FROM campaigns
WHERE id = 80;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Destinatários por estado — a resposta rápida
--
-- sent    = a mensagem foi aceite pelo SES (foi enviada)
-- pending = ainda não foi tentada; o cron vai enviá-la
-- retry   = falhou de forma temporária e vai ser tentada outra vez
-- failed  = não vai ser enviada (ver o motivo no ponto 4)
-- ───────────────────────────────────────────────────────────────────────────
SELECT status, COUNT(*)::int AS quantos
FROM campaign_recipients
WHERE campaign_id = 80
GROUP BY status
ORDER BY 2 DESC;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Quem recebeu, com a hora
--
-- message_id preenchido = o SES aceitou a mensagem para entrega. É a prova
-- de que aquele endereço foi mesmo enviado.
-- ───────────────────────────────────────────────────────────────────────────
SELECT email, sent_at, message_id
FROM campaign_recipients
WHERE campaign_id = 80 AND status = 'sent'
ORDER BY sent_at;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Quem não recebeu e porquê
-- ───────────────────────────────────────────────────────────────────────────
SELECT email, status, attempted_at, retry_count, error_message
FROM campaign_recipients
WHERE campaign_id = 80 AND status <> 'sent'
ORDER BY status, email;

-- ───────────────────────────────────────────────────────────────────────────
-- 5. Registo do servidor — independente do browser
--
-- Cada linha 'sent' é um envio; 'campaign_started' e 'campaign_completed'
-- marcam o início e o fim. Se houver 'campaign_completed', o envio terminou
-- do lado do servidor mesmo que o browser tenha dado erro.
-- ───────────────────────────────────────────────────────────────────────────
SELECT event_type, email, message_id, error, created_at
FROM email_send_log
WHERE campaign_id = 80
ORDER BY created_at;

-- ───────────────────────────────────────────────────────────────────────────
-- 6. Alguém recebeu duas vezes?
--
-- Só possível se o SES tiver aceitado a mensagem e o servidor tiver morrido
-- antes de gravar o estado, ficando a linha disponível para outro lote 2
-- minutos depois. Esperado: nenhuma linha.
-- ───────────────────────────────────────────────────────────────────────────
SELECT LOWER(email) AS email, COUNT(*)::int AS envios
FROM email_send_log
WHERE campaign_id = 80 AND event_type = 'sent'
GROUP BY LOWER(email)
HAVING COUNT(*) > 1
ORDER BY 2 DESC;
