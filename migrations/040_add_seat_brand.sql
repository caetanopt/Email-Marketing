-- Adiciona a marca Seat (distinta de Cupra)
-- Re-executável em segurança (idempotente).

INSERT INTO brands (id, name, color, logo_url, from_name, from_email) VALUES
  ('seat', 'Seat', '#E4002B', 'https://media.apps.caetano.pt/assets/img/brands/seat.svg', 'Seat', 'newsletter@seat.pt')
ON CONFLICT (id) DO NOTHING;

-- Concede acesso 'owner' a todos os administradores existentes, tal como a
-- migração 030 fez para as marcas anteriores. Sem isto, a marca aparece no
-- seletor mas devolve 404/403 em todos os pedidos (nenhum user_brand_roles).
INSERT INTO user_brand_roles (user_id, brand_id, role)
SELECT DISTINCT ubr.user_id, 'seat', 'owner'::user_role
FROM user_brand_roles ubr
WHERE ubr.role = 'owner'
ON CONFLICT (user_id, brand_id) DO UPDATE SET role = 'owner';
