-- Links das redes sociais usados APENAS no rodapé legal.
--
-- Ficam separados das variáveis da marca (brands.variables->>'facebook', etc.),
-- que continuam a servir o bloco "Redes Sociais" do editor e as variáveis
-- {{facebook}} dos templates. Assim é possível ter no rodapé um conjunto de
-- perfis diferente do que se usa no corpo do email.
--
-- Formato: {"facebook":"https://...","instagram":"https://...", ...}
ALTER TABLE global_settings ADD COLUMN IF NOT EXISTS footer_socials JSONB;
