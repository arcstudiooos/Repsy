-- PRD H13, F9: client reminder emails, each its own opt-in (off by default, like every non-essential email):
-- workout day (07:00 local), check-in due tonight (18:00 if not sent) and a habit nudge (19:00).
ALTER TABLE "notification_preferences" ADD COLUMN "workout_reminder_opt_in" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "notification_preferences" ADD COLUMN "checkin_reminder_opt_in" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "notification_preferences" ADD COLUMN "habit_reminder_opt_in" BOOLEAN NOT NULL DEFAULT false;

-- notification_preferences rows are self-only (migration 000011), but the worker sending a digest (PRD H14) or a
-- reminder must know the recipient's opt-ins: like app_message_email_opt_in (000025, 000032), this returns only
-- those booleans, only for a member of app_current_org(), with the bypass scoped to the call and a pinned path.
DO $do$
BEGIN
  EXECUTE pg_catalog.format($f$
    CREATE FUNCTION %1$I.app_email_opt_ins(target uuid)
      RETURNS TABLE (digest boolean, workout boolean, checkin boolean, habit boolean)
      LANGUAGE plpgsql VOLATILE
      SET search_path = %1$I, pg_temp
      AS $body$
      DECLARE
        prior_bypass text := pg_catalog.current_setting('app.bypass_rls', true);
      BEGIN
        PERFORM pg_catalog.set_config('app.bypass_rls', 'on', true);
        RETURN QUERY
        SELECT np.digest_email_opt_in, np.workout_reminder_opt_in, np.checkin_reminder_opt_in,
               np.habit_reminder_opt_in
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
