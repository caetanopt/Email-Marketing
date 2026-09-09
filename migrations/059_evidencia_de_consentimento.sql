-- G-3 (RGPD): evidência de consentimento por contacto.
--
-- Ao abrigo do RGPD, para enviar marketing é preciso poder mostrar COM QUE
-- base e DESDE QUANDO cada contacto está na lista. A tabela já guardava
-- 'source' e 'created_at', mas ambos podem ser reescritos por uma importação
-- posterior — não servem como prova estável. Estas colunas registam a
-- evidência no momento em que o contacto entra e não voltam a ser tocadas.
--
--   consent_source — de onde veio (ficheiro, formulário, API, sync…)
--   consent_at     — quando entrou
--   legal_basis    — a base legal do art. 6 (consentimento / interesse
--                    legítimo / …). Fica NULL de propósito: "por classificar".
--                    A classificação é uma decisão jurídica (DPO), não técnica.
--
-- NOTA: isto é o mecanismo técnico de registo. NÃO é aconselhamento jurídico
-- nem classifica a base legal — só cria o sítio onde essa decisão fica
-- guardada quando for tomada.

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS consent_source TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS consent_at     TIMESTAMPTZ;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS legal_basis    TEXT;

-- Preencher a evidência dos contactos que já existem, a partir do que se sabe
-- (source e created_at). Só onde ainda está vazio — não reescreve nada.
UPDATE contacts
   SET consent_source = COALESCE(consent_source, source),
       consent_at     = COALESCE(consent_at, created_at)
 WHERE consent_source IS NULL OR consent_at IS NULL;
