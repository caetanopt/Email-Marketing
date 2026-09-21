-- Desactivar a conta órfã admin@primemail.io
--
-- Criada pela migração 002 (seed) com papel de owner em TODAS as marcas. Está
-- ligada a um domínio que não é do grupo — primemail era o nome do protótipo
-- anterior. Ninguém a usa.
--
-- Não é uma porta aberta: não existe login por palavra-passe em lado nenhum do
-- backend, e por isso o hash bcrypt que a 002 gravou é inerte. Mas é uma conta
-- com o papel mais alto do sistema que ninguém reclama, e isso não se deixa
-- ficar.
--
-- DESACTIVAR, NÃO APAGAR. Duas razões:
--   • campaigns.created_by e templates.created_by são ON DELETE SET NULL —
--     apagar a conta apagaria a autoria do histórico dela.
--   • media (008) e custom_icons (020) referenciam users(id) SEM cláusula de
--     apagamento, ou seja NO ACTION: se a conta tiver alguma linha lá, o DELETE
--     falha a meio e fica tudo por fazer.
--
-- Correr no Supabase → SQL Editor, um passo de cada vez.


-- ── Passo 1. Ver o que lá está antes de mexer ─────────────────────────────
-- Confirma que a conta existe, se está activa, e quanto trabalho tem associado.
SELECT u.id, u.email, u.name, u.active, u.last_login, u.created_at,
       (SELECT COUNT(*) FROM user_brand_roles r WHERE r.user_id = u.id) AS papeis,
       (SELECT COUNT(*) FROM campaigns c        WHERE c.created_by = u.id) AS campanhas
  FROM users u
 WHERE u.email = 'admin@primemail.io';

-- Se `campanhas` não for zero, a conta foi usada para criar coisas a sério.
-- Desactivar continua a ser seguro — o histórico não se perde — mas vale a
-- pena perceber quem a usou antes de seguir.


-- ── Passo 2. Desactivar e cortar as sessões ───────────────────────────────
-- active = FALSE fecha os três caminhos de entrada:
--   • pedir um magic link       — api/auth.js filtra por active = TRUE
--   • usar um magic link já emitido — devolve ACCOUNT_INACTIVE
--   • uma sessão já aberta      — requireAuth revalida na BD a cada pedido
--
-- token_version + 1 invalida qualquer JWT já emitido no pedido seguinte, sem
-- esperar pelos 7 dias de validade (migração 057).
UPDATE users
   SET active = FALSE,
       token_version = COALESCE(token_version, 1) + 1
 WHERE email = 'admin@primemail.io';

-- Queimar magic links por usar, se algum tiver sido pedido.
DELETE FROM magic_link_tokens
 WHERE user_id = (SELECT id FROM users WHERE email = 'admin@primemail.io');


-- ── Passo 3 (opcional). Retirar os papéis ─────────────────────────────────
-- O passo 2 já basta: sem active não há entrada, e sem entrada os papéis não
-- fazem nada. Isto é só para a conta deixar de aparecer no ecrã de Equipa de
-- todas as marcas.
--
-- ATENÇÃO: se um dia a conta for reactivada, o login volta a dar-lhe owner em
-- todas as marcas activas — api/auth.js faz esse self-heal a quem JÁ tenha
-- algum papel de owner. Correr este passo é o que quebra esse automatismo, e é
-- por isso que ele é a parte que não se desfaz sozinha.
--
-- DELETE FROM user_brand_roles
--  WHERE user_id = (SELECT id FROM users WHERE email = 'admin@primemail.io');


-- ── Passo 4. Confirmar ────────────────────────────────────────────────────
-- active deve vir FALSE e token_version uma unidade acima do que estava.
SELECT id, email, active, token_version
  FROM users
 WHERE email = 'admin@primemail.io';

-- E confirmar que não ficou o grupo sem administradores — tem de devolver
-- pelo menos uma conta, e nenhuma delas pode ser a que acabou de desactivar.
SELECT DISTINCT u.id, u.email, u.active
  FROM users u
  JOIN user_brand_roles r ON r.user_id = u.id
 WHERE r.role = 'owner' AND u.active = TRUE
 ORDER BY u.email;


-- ── Desfazer ──────────────────────────────────────────────────────────────
-- UPDATE users SET active = TRUE WHERE email = 'admin@primemail.io';
--
-- Os papéis, se tiverem sido apagados no passo 3, voltam sozinhos no primeiro
-- login — mas só se a conta ainda tiver algum papel de owner algures. Se o
-- passo 3 os apagou a todos, têm de ser repostos à mão:
--
-- INSERT INTO user_brand_roles (user_id, brand_id, role)
-- SELECT u.id, b.id, 'owner' FROM users u, brands b
--  WHERE u.email = 'admin@primemail.io' AND b.active = TRUE
-- ON CONFLICT (user_id, brand_id) DO NOTHING;
