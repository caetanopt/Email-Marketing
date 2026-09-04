-- Chave de idempotência na criação de campanhas.
--
-- Quando a resposta do POST que cria a campanha não chega ao browser — um
-- 504 do proxy, a rede a cair, o portátil a suspender — a campanha JÁ ficou
-- gravada, mas o cliente não fica a saber o id e a gravação seguinte cria
-- outra. Era a origem das campanhas duplicadas com o mesmo assunto, às vezes
-- com uma hora de intervalo.
--
-- O cliente manda uma chave própria da sessão de edição; com a mesma chave, o
-- servidor devolve a campanha que já existe em vez de criar outra. O índice
-- único é o que resolve duas tentativas verdadeiramente simultâneas.
--
-- A API corre o mesmo em auto-migração; este ficheiro é para instalações
-- novas e para quem preferir correr as migrações à mão.

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS client_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS campaigns_client_key_uniq
  ON campaigns (client_key) WHERE client_key IS NOT NULL;
