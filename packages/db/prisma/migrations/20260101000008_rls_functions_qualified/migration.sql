-- NULLIF/COALESCE are SQL syntax constructs (not functions), so they cannot be shadowed or qualified.
-- Harden the RLS helper functions against search_path shadowing (e.g. pg_temp.uuid).
-- Bodies are fully schema-qualified. Function names stay unqualified so they replace the
-- ones from migration 000007 in whichever schema is being migrated (tests migrate into a
-- per-run schema). Policies bind by OID, so they keep working. Still STABLE, SECURITY INVOKER.
CREATE OR REPLACE FUNCTION app_current_org() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(pg_catalog.current_setting('app.org_id', true), '')::pg_catalog.uuid $$;

CREATE OR REPLACE FUNCTION app_rls_bypass() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT COALESCE(pg_catalog.current_setting('app.bypass_rls', true) OPERATOR(pg_catalog.=) 'on', false) $$;
