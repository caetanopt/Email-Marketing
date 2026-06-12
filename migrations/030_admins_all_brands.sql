-- Administradores (role 'owner') devem estar associados a TODAS as marcas activas
-- com a role 'owner'. Backfill imediato; o runtime (login, criação de marca,
-- auditoria) mantém esta invariante daqui em diante.

INSERT INTO user_brand_roles (user_id, brand_id, role)
SELECT DISTINCT ubr.user_id, b.id, 'owner'
FROM user_brand_roles ubr
CROSS JOIN brands b
WHERE ubr.role = 'owner' AND b.active = TRUE
ON CONFLICT (user_id, brand_id) DO UPDATE SET role = 'owner';

-- Administradores não podem ter restrições de áreas (acesso total)
DELETE FROM user_brand_areas
WHERE user_id IN (SELECT DISTINCT user_id FROM user_brand_roles WHERE role = 'owner');
