-- Disclaimer global do rodapé (Definições Globais → "Rodapé legal").
--
-- Aplica-se a todas as marcas. Cada marca pode ter o seu próprio disclaimer em
-- brands.variables->>'disclaimer' (campo que já existia); quando esse está
-- preenchido, sobrepõe-se a este.
ALTER TABLE global_settings ADD COLUMN IF NOT EXISTS disclaimer TEXT;

-- URL do logótipo institucional mostrado à esquerda na área do disclaimer.
-- É comum a todas as marcas (é o logótipo do grupo, não o da marca), por isso
-- vive aqui e não em brands.
ALTER TABLE global_settings ADD COLUMN IF NOT EXISTS footer_logo_url TEXT;
