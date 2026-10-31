-- PR #2 review, Minor findings (review D).
--
-- M2: app.lawful_erasure alone opened DELETE on set_log_revisions, messages and committed program history. Any
-- transaction can set a custom setting, so the exemption now also requires system scope (app.bypass_rls), which
-- only the erasure job combines with it.
--
-- M1: app_message_email_opt_in runs with the RLS bypass on. Its search_path is pinned to the migrated schema (then
-- pg_temp last) and its names are qualified, so a temporary table can't shadow memberships or
-- notification_preferences inside the bypass (as migration 000008 did for the RLS helpers).
--
-- M4: indexes for the check-in issuing scan and the latest-deletion-request lookup.
--
-- M5: support grants are audit-relevant: RESTRICT instead of CASCADE, like every other tenant FK. Erasure deletes a
-- client's grants explicitly first.

CREATE OR REPLACE FUNCTION set_log_revisions_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND pg_catalog.current_setting('app.lawful_erasure', true) OPERATOR(pg_catalog.=) 'on'
     AND app_rls_bypass() THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'set_log_revisions is append-only: % is not allowed', TG_OP;
END;
$$;

CREATE OR REPLACE FUNCTION messages_reject_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND pg_catalog.current_setting('app.lawful_erasure', true) OPERATOR(pg_catalog.=) 'on'
     AND app_rls_bypass() THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'messages are immutable: % is not allowed', TG_OP;
END;
$$;

CREATE OR REPLACE FUNCTION forbid_history_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND pg_catalog.current_setting('app.lawful_erasure', true) OPERATOR(pg_catalog.=) 'on'
     AND app_rls_bypass() THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% is immutable: % is not allowed', TG_TABLE_NAME, TG_OP;
END;
$$;

DO $do$
BEGIN
  EXECUTE pg_catalog.format($f$
    CREATE OR REPLACE FUNCTION %1$I.app_message_email_opt_in(target uuid) RETURNS boolean
      LANGUAGE sql STABLE
      SET app.bypass_rls = 'on'
      SET search_path = %1$I, pg_temp
      AS $body$
        SELECT COALESCE((
          SELECT np.message_email_opt_in FROM %1$I.notification_preferences np
           WHERE np.user_id OPERATOR(pg_catalog.=) target
             AND EXISTS (SELECT 1 FROM %1$I.memberships m
                          WHERE m.user_id OPERATOR(pg_catalog.=) target
                            AND m.organization_id OPERATOR(pg_catalog.=) %1$I.app_current_org())
        ), false)
      $body$
  $f$, pg_catalog.current_schema());
END
$do$;

CREATE INDEX "clients_checkin_issue_idx" ON "clients"("organization_id")
  WHERE "checkin_weekday" IS NOT NULL AND "status" IN ('active', 'paused');
CREATE INDEX "deletion_requests_subject_client_id_created_at_idx"
  ON "deletion_requests"("subject_client_id", "created_at");

ALTER TABLE "support_access_grants" DROP CONSTRAINT "support_access_grants_client_id_organization_id_fkey";
ALTER TABLE "support_access_grants" ADD CONSTRAINT "support_access_grants_client_id_organization_id_fkey"
  FOREIGN KEY ("client_id", "organization_id") REFERENCES "clients"("id", "organization_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
