-- PrimeMail — Dados iniciais
-- Password do admin: Admin1234!

INSERT INTO brands (id, name, color, from_name, from_email) VALUES
  ('caetano',     'Caetano',       '#002E5D', 'Caetano',        'newsletter@caetano.pt'),
  ('alpine',      'Alpine',        '#0055A4', 'Alpine',          'newsletter@alpine.pt'),
  ('audi',        'Audi',          '#BB0A21', 'Audi Portugal',  'newsletter@audi.pt'),
  ('bmw',         'BMW',           '#1C69D4', 'BMW Portugal',   'newsletter@bmw.pt'),
  ('bmwmotorrad', 'BMW Motorrad',  '#1C1C1C', 'BMW Motorrad',   'newsletter@bmwmotorrad.pt'),
  ('byd',         'BYD',           '#002060', 'BYD Portugal',   'newsletter@byd.pt'),
  ('carplus',     'Carplus',       '#1B1B1B', 'Carplus',        'newsletter@carplus.pt'),
  ('cupra',       'Cupra',         '#C8A96B', 'CUPRA',          'newsletter@cupra.pt'),
  ('dacia',       'Dacia',         '#1B1B1B', 'Dacia',          'newsletter@dacia.pt'),
  ('denza',       'Denza',         '#1B1B1B', 'Denza',          'newsletter@denza.pt'),
  ('dongfeng',    'Dongfeng',      '#003580', 'Dongfeng',       'newsletter@dongfeng.pt'),
  ('farizon',     'Farizon',       '#002AA3', 'Farizon',        'newsletter@farizon.pt'),
  ('geely',       'Geely',         '#003F7F', 'Geely',          'newsletter@geely.pt'),
  ('honda',       'Honda',         '#CC0000', 'Honda',          'newsletter@honda.pt'),
  ('hyundai',     'Hyundai',       '#002C5F', 'Hyundai',        'newsletter@hyundai.pt'),
  ('mercedes',    'Mercedes-Benz', '#1C1C1C', 'Mercedes-Benz',  'newsletter@mercedes.pt'),
  ('mini',        'MINI',          '#1F3146', 'MINI',           'newsletter@mini.pt'),
  ('nissan',      'Nissan',        '#C3002F', 'Nissan',         'newsletter@nissan.pt'),
  ('opel',        'Opel',          '#1C1C1C', 'Opel',           'newsletter@opel.pt'),
  ('peugeot',     'Peugeot',       '#1C1C1C', 'Peugeot',        'newsletter@peugeot.pt'),
  ('renault',     'Renault',       '#1C1C1C', 'Renault',        'newsletter@renault.pt'),
  ('skoda',       'Škoda',         '#4BA82E', 'Škoda',          'newsletter@skoda.pt'),
  ('toyota',      'Toyota',        '#EB0A1E', 'Toyota',         'newsletter@toyota.pt'),
  ('volkswagen',  'Volkswagen',    '#001E50', 'Volkswagen',     'newsletter@volkswagen.pt'),
  ('voyah',       'VOYAH',         '#1A1A1A', 'VOYAH',          'newsletter@voyah.pt'),
  ('xpeng',       'XPENG',         '#1B2F6E', 'XPENG',          'newsletter@xpeng.pt'),
  ('zeekr',       'Zeekr',         '#1A1A1A', 'Zeekr',          'newsletter@zeekr.pt'),
  ('caetanoparts','Caetano Parts', '#E63946', 'Caetano Parts',  'newsletter@caetanoparts.pt')
ON CONFLICT (id) DO NOTHING;

-- Admin: password = Admin1234!
INSERT INTO users (name, email, password_hash) VALUES
  ('Administrador', 'admin@caetano.pt', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi')
ON CONFLICT (email) DO NOTHING;

-- Dar acesso owner a todas as marcas ao admin
INSERT INTO user_brand_roles (user_id, brand_id, role)
SELECT u.id, b.id, 'owner'
FROM users u, brands b
WHERE u.email = 'admin@caetano.pt'
ON CONFLICT (user_id, brand_id) DO NOTHING;
