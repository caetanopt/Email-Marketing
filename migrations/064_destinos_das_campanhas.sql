-- Destinos legítimos de cada campanha, para o redireccionador de cliques.
--
-- O problema: todos os links de todas as campanhas são reescritos para
-- /api/track?type=click&cid=..&uid=..&t=..&url=<destino>. O handler valida o
-- token antes de redireccionar — e o comentário no código diz mesmo que isso
-- "prevents open-redirect abuse" — mas o token é HMAC(JWT_SECRET,
-- "track:<campanha>:<contacto>"): não cobre o parâmetro `url`.
--
-- O token autentica o PAR (campanha, contacto), não o DESTINO. Qualquer
-- pessoa que tenha recebido um email — ou a quem um email tenha sido
-- reencaminhado — tem um par válido e permanente, e pode trocar o destino por
-- o que quiser. O domínio emkt.caetano.pt, que serve o pixel, todos os links,
-- os ícones do rodapé e a página de cancelamento das 21 marcas, passa a
-- redireccionar para qualquer sítio.
--
-- Porque não se liga simplesmente o destino ao HMAC: isso invalidaria os
-- links de todas as campanhas que já estão nas caixas de correio das pessoas.
--
-- Esta tabela regista os destinos que cada campanha realmente contém, no
-- arranque do envio. O redireccionador passa a exigir que o host do destino
-- seja um dos da própria campanha.
--
-- Compatibilidade: campanhas SEM linhas aqui — todas as que já foram enviadas
-- — mantêm o comportamento actual e continuam a redireccionar. A protecção
-- liga-se sozinha para as campanhas novas, sem partir um único link já
-- entregue.
--
-- Compara-se por HOST e não por URL completo, de propósito: o injectTracking
-- acrescenta parâmetros UTM ao destino, e há templates com links montados a
-- partir de variáveis do contacto. O que interessa contra phishing é o
-- domínio que a pessoa vê, e esse tem de ser um dos da campanha.

CREATE TABLE IF NOT EXISTS campaign_links (
  id          SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  host        TEXT    NOT NULL,
  url         TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, host)
);

CREATE INDEX IF NOT EXISTS idx_campaign_links_campanha
  ON campaign_links (campaign_id);

COMMENT ON TABLE campaign_links IS
  'Hosts de destino que cada campanha contém, registados no arranque do envio. O redireccionador de cliques só aceita destinos nestes hosts. Campanhas sem linhas aqui (anteriores a esta migração) não são validadas, para não invalidar links já entregues.';
