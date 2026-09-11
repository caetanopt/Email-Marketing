-- Dar a cada campanha um template próprio, onde ele está partilhado.
--
-- Duplicar uma campanha criava a cópia a apontar para o MESMO template_id da
-- original (corrigido no código: a duplicação passou a clonar o template).
-- Como o editor grava o email com PUT no template, editar qualquer uma das
-- campanhas ligadas reescrevia o email de TODAS elas — e a pré-visualização
-- mostrava sempre o mesmo conteúdo, o da última edição, em campanhas
-- diferentes.
--
-- Esta migração desfaz o enredo: para cada template usado por mais do que uma
-- campanha, a campanha mais antiga fica no template original e cada uma das
-- outras recebe uma cópia própria. A partir daqui, editar uma campanha não
-- toca em mais nenhuma.
--
-- O QUE ESTA MIGRAÇÃO NÃO FAZ (e é importante saber):
-- não recupera o conteúdo antigo das campanhas já enviadas. Como o template
-- era partilhado e foi sendo reescrito, o corpo das edições anteriores já não
-- existe em lado nenhum — cada campanha recebe uma cópia do conteúdo ACTUAL.
-- Os emails que já saíram foram entregues com o conteúdo certo na altura;
-- é só a pré-visualização das antigas que passa a mostrar o conteúdo actual.
--
-- Idempotente: correr outra vez não faz nada, porque deixa de haver templates
-- partilhados.

-- ── 1. Diagnóstico — CORRE ISTO PRIMEIRO, para ver o que vai mudar ──────────
-- (é só uma leitura; não altera nada)
--
--   SELECT t.id   AS template_id,
--          t.name AS template,
--          COUNT(*) AS campanhas_ligadas,
--          string_agg(c.name || ' [' || c.status || ']', ' | ' ORDER BY c.id) AS quais
--     FROM campaigns c
--     JOIN templates t ON t.id = c.template_id
--    WHERE c.template_id IS NOT NULL
--    GROUP BY t.id, t.name
--   HAVING COUNT(*) > 1
--    ORDER BY COUNT(*) DESC;

-- ── 2. Separação ────────────────────────────────────────────────────────────
DO $$
DECLARE
  r        RECORD;
  novo_id  INT;
  total    INT := 0;
BEGIN
  FOR r IN
    SELECT c.id AS campaign_id, c.template_id, c.name AS campanha
      FROM campaigns c
     WHERE c.template_id IS NOT NULL
       -- o template é usado por mais do que uma campanha
       AND EXISTS (
             SELECT 1 FROM campaigns c2
              WHERE c2.template_id = c.template_id
                AND c2.id <> c.id
           )
       -- a campanha mais antiga de cada template fica onde está
       AND c.id <> (
             SELECT MIN(c3.id) FROM campaigns c3
              WHERE c3.template_id = c.template_id
           )
     ORDER BY c.template_id, c.id
  LOOP
    INSERT INTO templates (brand_id, name, subject, preview_text, html_content, created_by)
    SELECT t.brand_id,
           left(r.campanha || ' — Template', 200),
           t.subject, t.preview_text, t.html_content, t.created_by
      FROM templates t
     WHERE t.id = r.template_id
    RETURNING id INTO novo_id;

    -- Guarda: sem o clone, a UPDATE punha template_id a NULL e a campanha
    -- ficava sem email nenhum. Mais vale deixá-la partilhada do que vazia.
    IF novo_id IS NULL THEN
      RAISE WARNING 'Campanha % ("%") ficou como estava: não foi possível clonar o template %',
                    r.campaign_id, r.campanha, r.template_id;
      CONTINUE;
    END IF;

    UPDATE campaigns SET template_id = novo_id WHERE id = r.campaign_id;

    total := total + 1;
    RAISE NOTICE 'Campanha % ("%") passou do template % para o template % (próprio)',
                 r.campaign_id, r.campanha, r.template_id, novo_id;
  END LOOP;

  RAISE NOTICE 'Separação concluída: % campanha(s) passaram a ter template próprio.', total;
END $$;

-- ── 3. Verificação — não deve devolver nenhuma linha ────────────────────────
--
--   SELECT template_id, COUNT(*)
--     FROM campaigns WHERE template_id IS NOT NULL
--    GROUP BY template_id HAVING COUNT(*) > 1;
