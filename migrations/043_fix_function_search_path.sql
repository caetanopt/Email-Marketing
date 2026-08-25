-- Corrige o aviso "Function Search Path Mutable" do Supabase Security
-- Advisor para public.set_updated_at.
--
-- Esta função (provavelmente um trigger que actualiza updated_at em
-- UPDATE) não está definida em nenhuma migração deste repositório — foi
-- criada directamente no painel do Supabase, por isso não sabemos o corpo
-- exacto. Não é preciso saber: o aviso é só sobre o "search_path" da
-- função não estar fixo, o que é uma boa prática de segurança (evita que
-- alguém com permissões para criar objectos noutro schema consiga
-- "sequestrar" chamadas dentro da função). ALTER FUNCTION só define esta
-- propriedade — não altera o comportamento da função.

ALTER FUNCTION public.set_updated_at() SET search_path = public;
