-- Simplify roles: merge 'admin' into 'owner' (they had identical permissions)
-- After this migration, valid roles are: owner | editor | viewer
UPDATE users SET role = 'owner' WHERE role = 'admin';
UPDATE user_brand_roles SET role = 'owner' WHERE role = 'admin';
