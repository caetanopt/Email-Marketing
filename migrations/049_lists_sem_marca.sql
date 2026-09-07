-- Desvincula as listas de email das marcas.
--
-- As listas passaram a ser globais na migração 037 — uma "Marketing" e uma
-- "Colaboradores" partilhadas por todas as marcas — mas a coluna
-- lists.brand_id ficou lá, declarada NOT NULL e com ON DELETE CASCADE para
-- brands. A 037 atribuiu as listas à primeira marca activa.
--
-- Isso deixou um risco sério: apagar essa marca apagava as listas globais e
-- TODOS os seus membros, para todas as marcas. A coluna também não filtrava
-- nada — nenhuma consulta a usava para restringir listas a uma marca.
--
-- Os segmentos continuam a ter brand_id e a ser por marca: isso é de propósito
-- e não é tocado aqui.

ALTER TABLE lists ALTER COLUMN brand_id DROP NOT NULL;
DROP INDEX IF EXISTS idx_lists_brand;
ALTER TABLE lists DROP COLUMN IF EXISTS brand_id;
