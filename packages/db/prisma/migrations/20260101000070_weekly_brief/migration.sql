-- PRD I9: the Monday brief for coaches, its own opt-in (off by default). app_email_opt_ins (000056) gains the
-- `brief` column; its body and safeguards are unchanged.
ALTER TABLE "notification_preferences" ADD COLUMN "weekly_brief_opt_in" BOOLEAN NOT NULL DEFAULT false;

DO $do$
BEGIN
  EXECUTE pg_catalog.format($f$
    DROP FUNCTION %1$I.app_email_opt_ins(uuid);
    CREATE FUNCTION %1$I.app_email_opt_ins(target uuid)
      RETURNS TABLE (digest boolean, workout boolean, checkin boolean, habit boolean, brief boolean)
      LANGUAGE plpgsql VOLATILE
      SET search_path = %1$I, pg_temp
      AS $body$
      DECLARE
        prior_bypass text := pg_catalog.current_setting('app.bypass_rls', true);
      BEGIN
        PERFORM pg_catalog.set_config('app.bypass_rls', 'on', true);
        RETURN QUERY
        SELECT np.digest_email_opt_in, np.workout_reminder_opt_in, np.checkin_reminder_opt_in,
               np.habit_reminder_opt_in, np.weekly_brief_opt_in
          FROM %1$I.notification_preferences np
         WHERE np.user_id OPERATOR(pg_catalog.=) target
           AND EXISTS (SELECT 1 FROM %1$I.memberships m
                        WHERE m.user_id OPERATOR(pg_catalog.=) target
                          AND m.organization_id OPERATOR(pg_catalog.=) %1$I.app_current_org());
        PERFORM pg_catalog.set_config('app.bypass_rls', COALESCE(prior_bypass, ''), true);
      END
      $body$
  $f$, pg_catalog.current_schema());
END
$do$;
