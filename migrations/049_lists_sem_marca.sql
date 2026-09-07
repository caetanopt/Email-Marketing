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

-- Apagar a coluna leva com ela a chave estrangeira (o CASCADE) e os índices
-- que dependem dela: idx_lists_brand e lists_brand_name_unique (018).
DROP INDEX IF EXISTS idx_lists_brand;
ALTER TABLE lists DROP COLUMN IF EXISTS brand_id;

-- O lists_brand_name_unique era (brand_id, name): garantia que não havia dois
-- nomes iguais dentro da mesma marca. Sem a coluna, deixava de existir
-- qualquer garantia de nome único — e as migrações 022 e 037 tiveram de
-- limpar listas duplicadas, ou seja, já aconteceu. Substitui-se por um índice
-- único sobre o nome em minúsculas, que é a mesma verificação que a API faz.
--
-- Se já existirem nomes repetidos, o índice não pode ser criado: o resto da
-- migração fica aplicado e é emitido um aviso com o que resolver. A consulta
-- para os encontrar está no fim deste ficheiro.
DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS lists_name_unique_ci ON lists (LOWER(name));
EXCEPTION WHEN unique_violation THEN
  RAISE WARNING 'Existem listas com o mesmo nome: o índice lists_name_unique_ci não foi criado. Corre a consulta no fim de 049_lists_sem_marca.sql para as encontrar, funde-as e volta a correr esta migração.';
END $$;

-- Para encontrar nomes repetidos, se o aviso acima aparecer:
--
--   SELECT LOWER(name) AS nome, COUNT(*), ARRAY_AGG(id ORDER BY id) AS ids
--   FROM lists GROUP BY LOWER(name) HAVING COUNT(*) > 1;
