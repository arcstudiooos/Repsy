-- D-001 / D-002: committed program history is immutable. Sessions will reference these rows, so the guarantee
-- is enforced by the database itself. Deliberately NOT exempt for system code or RLS bypass: history never changes.
-- Cleanup that drops the whole schema (tests) is unaffected because DROP does not fire row triggers.

CREATE FUNCTION forbid_history_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is immutable: % is not allowed', TG_TABLE_NAME, TG_OP;
END;
$$;

CREATE TRIGGER workout_versions_immutable
  BEFORE UPDATE OR DELETE ON "workout_versions"
  FOR EACH ROW EXECUTE FUNCTION forbid_history_mutation();
CREATE TRIGGER workout_versions_no_truncate
  BEFORE TRUNCATE ON "workout_versions"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_history_mutation();

CREATE TRIGGER workout_version_exercises_immutable
  BEFORE UPDATE OR DELETE ON "workout_version_exercises"
  FOR EACH ROW EXECUTE FUNCTION forbid_history_mutation();
CREATE TRIGGER workout_version_exercises_no_truncate
  BEFORE TRUNCATE ON "workout_version_exercises"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_history_mutation();

CREATE TRIGGER program_versions_immutable
  BEFORE UPDATE OR DELETE ON "program_versions"
  FOR EACH ROW EXECUTE FUNCTION forbid_history_mutation();
CREATE TRIGGER program_versions_no_truncate
  BEFORE TRUNCATE ON "program_versions"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_history_mutation();

CREATE TRIGGER program_slots_immutable
  BEFORE UPDATE OR DELETE ON "program_slots"
  FOR EACH ROW EXECUTE FUNCTION forbid_history_mutation();
CREATE TRIGGER program_slots_no_truncate
  BEFORE TRUNCATE ON "program_slots"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_history_mutation();
