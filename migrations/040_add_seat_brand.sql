-- Adiciona a marca Seat (distinta de Cupra)

INSERT INTO brands (id, name, color, logo_url, from_name, from_email) VALUES
  ('seat', 'Seat', '#E4002B', 'https://media.apps.caetano.pt/assets/img/brands/seat.svg', 'Seat', 'newsletter@seat.pt')
ON CONFLICT (id) DO NOTHING;
