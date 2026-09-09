-- S-3: permitir revogar sessões (JWT) antes da expiração de 7 dias.
--
-- O requireAuth só verificava a assinatura do token — não consultava a BD, por
-- isso não via um utilizador desactivado, apagado, ou uma sessão revogada. Um
-- utilizador despedido mantinha acesso durante 7 dias.
--
-- token_version entra no JWT no login e é revalidado contra a BD a cada
-- pedido. Apagar o utilizador (o row desaparece) já invalida o token; para
-- "terminar sessão em todo o lado" sem apagar, incrementa-se token_version.
-- Idempotente.

ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 1;

-- Para revogar todas as sessões de um utilizador (ex.: suspeita de fuga):
--   UPDATE users SET token_version = token_version + 1 WHERE id = <id>;
-- Os tokens já emitidos deixam de ser aceites no pedido seguinte.
