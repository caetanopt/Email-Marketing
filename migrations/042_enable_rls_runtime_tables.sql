-- Follow-up to 041_enable_rls.sql: three tables were missed because they
-- aren't created by a migration file — they're created lazily at runtime
-- by the app itself the first time the relevant feature is used
-- (api/auth.js -> magic_link_tokens, api/contacts/index.js -> import_jobs
-- and import_chunks). The Supabase Security Advisor caught them anyway
-- since it inspects the live database, not this repo's migrations/.
--
-- magic_link_tokens is the most sensitive of the three: it stores the raw,
-- unhashed login token for the "sign in via email link" flow. Exposed
-- publicly via PostgREST, anyone could read a valid, unused token and log
-- in as that user without a password — worse than the password_hash/
-- api_key exposure already fixed by 041.

ALTER TABLE IF EXISTS magic_link_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS import_jobs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS import_chunks     ENABLE ROW LEVEL SECURITY;
