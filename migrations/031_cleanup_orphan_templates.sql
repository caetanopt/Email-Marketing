-- A tabela templates NÃO pode ser apagada: cada campanha guarda o seu HTML
-- num registo de templates (campaigns.template_id -> templates.html_content)
-- e o envio lê esse HTML. Apenas templates órfãos (sem campanha associada,
-- restos da antiga área de Templates) podem ser removidos.

-- 1) VERIFICAÇÃO — corre primeiro para ver o que existe:
SELECT
  t.brand_id,
  COUNT(*)                                                       AS total_templates,
  COUNT(*) FILTER (WHERE c.id IS NOT NULL)                       AS usados_por_campanhas,
  COUNT(*) FILTER (WHERE c.id IS NULL)                           AS orfaos_para_apagar
FROM templates t
LEFT JOIN campaigns c ON c.template_id = t.id
GROUP BY t.brand_id
ORDER BY t.brand_id;

-- 2) LIMPEZA — apaga apenas os órfãos (corre depois de confirmares os números acima):
-- DELETE FROM templates t
-- WHERE NOT EXISTS (SELECT 1 FROM campaigns c WHERE c.template_id = t.id);
