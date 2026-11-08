-- Runtime database role for Repsy (web + worker).
--
-- Run as the DATABASE OWNER (the role that runs `prisma migrate deploy`), never
-- as the runtime role. Idempotent: safe to re-run after every migration.
--
--   PGOPTIONS="-c repsy.app_password=$REPSY_APP_PASSWORD" \
--     psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/sql/app-role.sql
--
-- The password is passed per session through the `repsy.app_password` setting,
-- so it is never written to this file. Optional overrides (defaults in brackets):
--   repsy.app_role [repsy_app]   repsy.app_schema [public]   repsy.pgboss_schema [pgboss]
--
-- The role is deliberately powerless: no superuser, no BYPASSRLS, no DDL, and it
-- owns nothing, so Row-Level Security always applies to it. The app refuses to
-- boot in production if it is connected as anything else (assertRuntimeRole).
DO $$
DECLARE
  role_name   text := COALESCE(NULLIF(current_setting('repsy.app_role', true), ''), 'repsy_app');
  app_schema  text := COALESCE(NULLIF(current_setting('repsy.app_schema', true), ''), 'public');
  boss_schema text := COALESCE(NULLIF(current_setting('repsy.pgboss_schema', true), ''), 'pgboss');
  pw          text := current_setting('repsy.app_password', true);
  schema_name text;
BEGIN
  IF pw IS NULL OR pw = '' THEN
    RAISE EXCEPTION 'repsy.app_password is not set (pass it via PGOPTIONS, see the header of this file)';
  END IF;

  -- The owner may be a plain CREATEROLE role (Render), which cannot ALTER superuser-class
  -- attributes: set them once at CREATE time, and rotate with a password-only ALTER.
  -- Password-bearing statements are wrapped so a failure never echoes the password
  -- (psql stderr and server logs print the failing statement in the error context).
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
    BEGIN
      EXECUTE format(
        'CREATE ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L',
        role_name, pw);
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'creating role % failed (SQLSTATE %)', role_name, SQLSTATE;
    END;
  ELSE
    BEGIN
      EXECUTE format('ALTER ROLE %I PASSWORD %L', role_name, pw);
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'setting % password failed (SQLSTATE %)', role_name, SQLSTATE;
    END;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_roles
     WHERE rolname = role_name
       AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication OR NOT rolcanlogin)
  ) THEN
    RAISE EXCEPTION 'role % has unsafe attributes; drop it and re-run, or fix it as a superuser', role_name;
  END IF;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), role_name);

  -- pg-boss keeps its tables in its own schema; created here so the default
  -- privileges below exist before `pnpm --filter @repsy/worker pgboss:migrate` runs.
  EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', boss_schema);

  FOREACH schema_name IN ARRAY ARRAY[app_schema, boss_schema] LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I', schema_name, role_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO %I', schema_name, role_name);
    EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO %I', schema_name, role_name);
    EXECUTE format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA %I TO %I', schema_name, role_name);
    -- Tables the owner creates later (future migrations) are usable without a re-run.
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
      schema_name, role_name);
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO %I',
      schema_name, role_name);
  END LOOP;
END
$$;
