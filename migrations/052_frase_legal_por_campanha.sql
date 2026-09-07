-- Opção, por campanha, de não enviar a frase legal do rodapé.
--
-- A frase é a que identifica o remetente e a sede da empresa:
--
--   Este e-mail foi enviado para <email> por © 2026 Caetano Automotive
--   Portugal, S.A., com sede na Rua do Barreiro 547, 4409-513 Vila Nova de
--   Gaia, matriculada na CRCOM.VNGAIA com o Nº/NIPC 500003165.
--
-- Por omissão continua a ser enviada em todas as campanhas (FALSE), e as
-- campanhas que já existem ficam com esse valor. A opção está no ecrã de
-- envio, no cartão "Rodapé legal".
--
-- A linha de links por baixo da frase — Política de privacidade | Versão web |
-- Cancelar subscrição — não é afectada e continua em todos os envios: o link
-- de cancelamento é exigido a quem envia em volume (Gmail e Yahoo desde
-- Fevereiro de 2024) e é o par do cabeçalho List-Unsubscribe.
--
-- A aplicação cria esta coluna sozinha à primeira gravação, se ainda não
-- existir (ver lib/campanhas.js). Esta migração é para o esquema ficar
-- registado no repositório e para bases de dados onde a aplicação não tenha
-- privilégio de ALTER TABLE.

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS no_legal_notice BOOLEAN NOT NULL DEFAULT FALSE;

-- Verificação — quantas campanhas têm a frase desligada (esperado: 0 logo
-- depois de correr).
SELECT COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE no_legal_notice)::int AS sem_frase_legal
FROM campaigns;
