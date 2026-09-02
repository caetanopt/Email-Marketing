-- Largura total do email: 600px -> 640px.
--
-- O campo "Largura padrão do email" já existia em Definições Globais e era
-- gravado, mas nada o lia: os 600px estavam escritos à mão no gerador de
-- MJML, no gerador de HTML de recurso, no rodapé legal e no canvas do editor.
-- Passou a ser este valor que todos usam, e o defeito passa a 640px.
--
-- A coluna email_width_migrated marca a actualização pontual do valor já
-- gravado como feita, para não voltar a sobrepor-se a uma escolha posterior.
-- A API corre o mesmo em auto-migração; este ficheiro é para instalações
-- novas e para quem preferir correr as migrações à mão.

ALTER TABLE global_settings
  ADD COLUMN IF NOT EXISTS email_width_migrated BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE global_settings
  ALTER COLUMN email_width SET DEFAULT '640px';

UPDATE global_settings
   SET email_width = '640px',
       email_width_migrated = TRUE
 WHERE id = 1
   AND email_width_migrated = FALSE;
