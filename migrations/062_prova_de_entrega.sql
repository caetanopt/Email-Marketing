-- Prova durável de que houve tentativa de entrega ao SES.
--
-- Porquê: a migração 060 introduziu o estado 'sending' e afirma que uma linha
-- entregue-mas-não-gravada "fica em 'sending', à espera de reconciliação
-- explícita — nunca reenviada por engano". O código não fazia isso.
--
-- O predicado de reivindicação aceita qualquer linha em 'sending' com
-- attempted_at de há mais de 2 minutos. E o attempted_at de uma linha
-- entregue-mas-não-gravada é o instante do CLAIM — porque foi precisamente o
-- UPDATE que o actualizaria que falhou. O relógio começa a contar no claim, e
-- o reenvio aos 2 minutos era determinístico, não acidental: a própria linha
-- impede a campanha de concluir, o que obriga o cron a voltar lá.
--
-- O predicado tentava servir dois objectivos que a base de dados não conseguia
-- distinguir:
--   • linha órfã, reclamada e NÃO entregue (worker morto) — tem de ser reenviada;
--   • linha entregue e não gravada — nunca pode ser reenviada.
-- A única prova da entrega estava na escrita que falhou.
--
-- Esta coluna é essa prova. É escrita ANTES de a onda ser entregue ao SES, por
-- isso sobrevive à falha da escrita seguinte e à morte do processo. Quem a tem
-- preenchida deixa de ser reclamável; fica para reconciliação.

ALTER TABLE campaign_recipients
  ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMPTZ;

-- Índice parcial para a reconciliação: linhas entregues que nunca chegaram a
-- 'sent'. É uma lista curta por natureza, e o índice mantém-na barata de achar
-- mesmo com a tabela a crescer.
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_por_reconciliar
  ON campaign_recipients (campaign_id)
  WHERE dispatched_at IS NOT NULL AND status = 'sending';

COMMENT ON COLUMN campaign_recipients.dispatched_at IS
  'Instante em que a mensagem foi entregue ao SES. Escrito antes do envio. Uma linha com este valor preenchido NUNCA pode ser reivindicada de novo — seria um email duplicado.';
