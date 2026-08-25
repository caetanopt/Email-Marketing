-- Corrige os avisos do Supabase Security Advisor:
--   - "Table publicly accessible" (rls_disabled_in_public)
--   - "Sensitive data publicly accessible" (sensitive_columns_exposed) —
--     nomeadamente users.password_hash e brands.api_key
--
-- Nenhuma tabela desta base de dados tinha Row Level Security activado, o
-- que significa que QUALQUER pessoa com a URL do projecto e a "anon key"
-- do Supabase conseguia ler/editar/apagar todas as linhas de todas as
-- tabelas através da API REST automática do Supabase (PostgREST) —
-- incluindo password_hash, api_key, e todos os contactos (RGPD).
--
-- Esta app NUNCA usa essa API REST/anon key — liga-se directamente ao
-- Postgres via DATABASE_URL (biblioteca "pg"). Por isso activar RLS sem
-- nenhuma política (bloqueio total via PostgREST) resolve o aviso sem
-- afectar o funcionamento da app, desde que a ligação DATABASE_URL use
-- o role "postgres" por omissão do Supabase (tem BYPASSRLS, ignora RLS).
-- IMPORTANTE: testar a app depois de correr esta migração (listar
-- contactos, campanhas, etc.) antes de dar como concluído.

ALTER TABLE IF EXISTS brands             ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS brand_blocks       ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS campaign_lists     ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS campaign_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS campaigns          ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS contacts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS custom_icons       ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS domain_whitelist   ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS email_events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS email_send_log     ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS global_settings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS imports            ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS list_members       ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS lists              ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS media              ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS segments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS suppression        ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS templates          ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS user_brand_areas   ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS user_brand_roles   ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS users              ENABLE ROW LEVEL SECURITY;

-- Sem CREATE POLICY propositadamente: RLS activado + zero políticas =
-- acesso negado por omissão a quem usar a API REST (roles anon/
-- authenticated). Esta app não usa esses roles, por isso não precisa de
-- nenhuma política — só de bloquear o acesso público.
