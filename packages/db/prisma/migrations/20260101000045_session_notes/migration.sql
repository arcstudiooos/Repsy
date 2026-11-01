-- PRD D9: notes on an exercise or set in a session, by the client or coach. Immutable; forced RLS.

-- CreateTable
CREATE TABLE "session_notes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "workout_version_exercise_id" UUID NOT NULL,
    "set_index" INTEGER,
    "body" TEXT NOT NULL,
    "author_user_id" UUID NOT NULL,
    "author_role" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "session_notes_session_id_created_at_idx" ON "session_notes"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "session_notes_organization_id_idx" ON "session_notes"("organization_id");

-- AddForeignKey
ALTER TABLE "session_notes" ADD CONSTRAINT "session_notes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_notes" ADD CONSTRAINT "session_notes_session_id_organization_id_fkey" FOREIGN KEY ("session_id", "organization_id") REFERENCES "workout_sessions"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_notes" ADD CONSTRAINT "session_notes_workout_version_exercise_id_organization_id_fkey" FOREIGN KEY ("workout_version_exercise_id", "organization_id") REFERENCES "workout_version_exercises"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "session_notes" ADD CONSTRAINT "session_notes_body_check" CHECK (char_length("body") BETWEEN 1 AND 500);
ALTER TABLE "session_notes" ADD CONSTRAINT "session_notes_set_index_check" CHECK ("set_index" IS NULL OR "set_index" BETWEEN 0 AND 19);
ALTER TABLE "session_notes" ADD CONSTRAINT "session_notes_author_role_check" CHECK ("author_role" IN ('client', 'coach'));

ALTER TABLE "session_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "session_notes" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "session_notes" FOR ALL
  USING (organization_id = app_current_org() OR app_rls_bypass())
  WITH CHECK (organization_id = app_current_org() OR app_rls_bypass());

-- Immutable like messages (000030): no update, delete or truncate except a lawful-erasure delete.
CREATE FUNCTION session_notes_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND pg_catalog.current_setting('app.lawful_erasure', true) OPERATOR(pg_catalog.=) 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'session_notes are append-only: % is not allowed', TG_OP;
END;
$$;

CREATE TRIGGER session_notes_no_change
  BEFORE UPDATE OR DELETE ON "session_notes"
  FOR EACH ROW EXECUTE FUNCTION session_notes_reject_change();
CREATE TRIGGER session_notes_no_truncate
  BEFORE TRUNCATE ON "session_notes"
  FOR EACH STATEMENT EXECUTE FUNCTION session_notes_reject_change();
