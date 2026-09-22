-- Quem já recebeu uma campanha interrompida, e como não lhes enviar de novo.
--
-- O ID que aparece na listagem (ex.: 20-1789565118) é o número da marca mais a
-- data de criação da campanha em segundos. É por aí que estas consultas a
-- encontram, sem ser preciso saber o id interno.
--
-- ⚠ ANTES DE MAIS: se a intenção é acabar de enviar ESTA campanha, não é
-- preciso nada disto. Ver a nota no fim — a plataforma já garante que ninguém
-- recebe duas vezes.

-- Mudar aqui, e só aqui:
--   \set idvisivel 1789565118


-- ── 1. Que campanha é, e como está ────────────────────────────────────────
SELECT c.id                                   AS id_interno,
       c.name,
       c.status::text,
       c.created_at,
       c.sent_at,
       COUNT(cr.*)                                        AS destinatarios,
       COUNT(*) FILTER (WHERE cr.status = 'sent')         AS ja_receberam,
       COUNT(*) FILTER (WHERE cr.status = 'pending')      AS por_enviar,
       COUNT(*) FILTER (WHERE cr.status = 'retry')        AS a_repetir,
       COUNT(*) FILTER (WHERE cr.status = 'sending')      AS reclamados,
       COUNT(*) FILTER (WHERE cr.status = 'failed')       AS falhados,
       COUNT(*) FILTER (WHERE cr.status = 'bounced')      AS devolvidos,
       COUNT(*) FILTER (WHERE cr.status = 'suppressed')   AS suprimidos
  FROM campaigns c
  LEFT JOIN campaign_recipients cr ON cr.campaign_id = c.id
 WHERE floor(extract(epoch FROM c.created_at)) = 1789565118
 GROUP BY c.id, c.name, c.status, c.created_at, c.sent_at;

-- `ja_receberam` é o número que interessa: são os emails que SAÍRAM mesmo.
-- `reclamados` (status 'sending') são linhas apanhadas a meio pela
-- interrupção. Se tiverem dispatched_at preenchido, também saíram — ver 2.


-- ── 2. Os que ficaram a meio ──────────────────────────────────────────────
-- Uma linha em 'sending' foi reclamada por um trabalhador. dispatched_at
-- preenchido = a mensagem foi entregue ao SES, logo a pessoa recebeu, mesmo
-- que o estado 'sent' não tenha chegado a ser gravado. Estas NÃO se reenviam.
SELECT COUNT(*) FILTER (WHERE dispatched_at IS NOT NULL) AS sairam_mas_nao_gravados,
       COUNT(*) FILTER (WHERE dispatched_at IS NULL)     AS nao_sairam
  FROM campaign_recipients
 WHERE campaign_id = (SELECT id FROM campaigns
                       WHERE floor(extract(epoch FROM created_at)) = 1789565118)
   AND status = 'sending';


-- ── 3. A lista de quem já recebeu ─────────────────────────────────────────
-- Para exportar (botão Download CSV do Supabase) se for mesmo precisa.
SELECT cr.email,
       cr.sent_at,
       cr.status::text
  FROM campaign_recipients cr
 WHERE cr.campaign_id = (SELECT id FROM campaigns
                          WHERE floor(extract(epoch FROM created_at)) = 1789565118)
   AND (cr.status = 'sent' OR cr.dispatched_at IS NOT NULL)
 ORDER BY cr.sent_at;


-- ══════════════════════════════════════════════════════════════════════════
-- O QUE FAZER A SEGUIR
-- ══════════════════════════════════════════════════════════════════════════
--
-- ── Caso A: acabar de enviar esta campanha (o normal) ─────────────────────
--
-- NÃO É PRECISO FAZER NADA. Voltar a enviar a MESMA campanha não reenvia a
-- ninguém, por construção e em dois sítios independentes:
--
--   • o arranque acrescenta destinatários com
--       ON CONFLICT (campaign_id, contact_id) DO NOTHING
--     — as linhas que já estão em 'sent' ficam como estão;
--   • cada lote só reclama linhas em 'pending' ou 'retry'. Uma linha 'sent'
--     nunca volta a ser escolhida.
--
-- Basta abrir a campanha e enviar outra vez. Ela retoma onde ficou.
--
--
-- ── Caso B: criar uma campanha NOVA com o mesmo conteúdo ──────────────────
--
-- ⚠ AQUI SIM HÁ RISCO DE DUPLICADO. Uma campanha nova (ou duplicada) tem os
-- seus próprios destinatários: toda a gente recebe, incluindo quem já recebeu
-- da campanha interrompida. Nada na plataforma impede isso — não há memória
-- entre campanhas diferentes.
--
-- Se tiver mesmo de ser uma campanha nova, a forma de excluir quem já recebeu
-- é marcar essas linhas como já tratadas na campanha nova, DEPOIS de a criar e
-- ANTES de a enviar. Substituir <ID_DA_NOVA> pelo id interno da campanha nova
-- (a consulta 1 dá o id_interno da antiga; para a nova, correr a mesma com o
-- ID visível dela):
--
--   INSERT INTO campaign_recipients (campaign_id, contact_id, email, status)
--   SELECT <ID_DA_NOVA>, cr.contact_id, cr.email, 'suppressed'
--     FROM campaign_recipients cr
--    WHERE cr.campaign_id = (SELECT id FROM campaigns
--                             WHERE floor(extract(epoch FROM created_at)) = 1789565118)
--      AND (cr.status = 'sent' OR cr.dispatched_at IS NOT NULL)
--   ON CONFLICT (campaign_id, contact_id) DO NOTHING;
--
-- 'suppressed' é um estado terminal: essas linhas não são reclamadas por
-- nenhum lote e não contam como por enviar. Correr ANTES do envio — depois de
-- arrancar já não adianta.
--
-- Confirmar antes de enviar que o número bate certo com `ja_receberam` da
-- consulta 1:
--
--   SELECT status::text, COUNT(*) FROM campaign_recipients
--    WHERE campaign_id = <ID_DA_NOVA> GROUP BY 1;
