-- Contactos não listados: os que entram por um ficheiro no envio de uma
-- campanha.
--
-- Ao carregar um ficheiro no passo dos destinatários, cada endereço tem de
-- ficar gravado em contacts — é assim que passa a ser destinatário da
-- campanha, e é a linha do contacto que sustenta o relatório do envio. Mas
-- esses endereços não são contactos da empresa: não devem aparecer na página
-- de Contactos, que é partilhada por todos os utilizadores.
--
-- Esta coluna marca-os. A listagem de contactos exclui os marcados; tudo o
-- resto (envio, relatórios, supressões) ignora a marca e continua igual.
--
-- Deixam de estar marcados no momento em que entram numa lista, por
-- importação ou à mão: aí passam a ser contactos como os outros.
--
-- Porque não são simplesmente apagados no fim do envio: já eram, e
-- campaign_recipients.contact_id é ON DELETE CASCADE — apagar o contacto
-- apagava a linha do destinatário e a campanha ficava sem relatório nenhum
-- (0 enviados, sem registo de erros) logo depois de ter sido enviada.
--
-- A aplicação cria esta coluna sozinha à primeira gravação que precise dela.
-- Esta migração é para o esquema ficar registado no repositório e para bases
-- de dados onde a aplicação não tenha privilégio de ALTER TABLE.

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT FALSE;

-- A listagem filtra por esta coluna em todas as consultas de contactos.
CREATE INDEX IF NOT EXISTS idx_contacts_hidden ON contacts (hidden) WHERE hidden;

-- Verificação — quantos contactos estão fora da listagem (esperado: 0 logo
-- depois de correr).
SELECT COUNT(*)::int AS contactos,
       COUNT(*) FILTER (WHERE hidden)::int AS nao_listados
FROM contacts;
