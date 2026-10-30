-- D-002 #6: a session's workout version is written once (when it is started, completed or skipped) and never
-- changes afterwards; set logs and history are recorded against it. Enforced by the database as well as by core,
-- like the version immutability triggers of migration 000014. Deliberately NOT exempt for system code or RLS bypass.
-- Setting it from NULL stays allowed (that is the lock itself).

CREATE FUNCTION forbid_session_version_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.workout_version_id IS NOT NULL
     AND NEW.workout_version_id IS DISTINCT FROM OLD.workout_version_id THEN
    RAISE EXCEPTION 'workout_sessions.workout_version_id is locked: it can not change once set';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER workout_sessions_version_locked
  BEFORE UPDATE OF workout_version_id ON "workout_sessions"
  FOR EACH ROW EXECUTE FUNCTION forbid_session_version_change();
