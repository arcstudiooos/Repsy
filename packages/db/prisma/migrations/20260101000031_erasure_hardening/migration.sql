-- PR #2 review (C-I1, C-I2, D-I4): make lawful erasure complete and recoverable.
--
-- deletion_requests.attempts / last_error_code: a failing erasure is recorded (a short code, never content) and
-- ordered after untried requests, so one bad request no longer blocks every later one.
--
-- export_jobs.purged_at: export files are removed from storage by a sweep that retries until it succeeds, for
-- expired exports and for exports an erasure expired. The keys stay on the row (files_json) until then, so a storage
-- failure can no longer lose them.
--
-- Committed program history (000014) stays immutable for UPDATE and TRUNCATE always, and for DELETE unless the
-- transaction set app.lawful_erasure = 'on' (transaction-local; only the deletion job does, as for set_log_revisions
-- in 000029 and messages in 000030). Erasure removes the client's own program copies (versions, slots and the
-- workout versions no other program uses).

ALTER TABLE "deletion_requests" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "deletion_requests" ADD COLUMN "last_error_code" TEXT;

ALTER TABLE "export_jobs" ADD COLUMN "purged_at" TIMESTAMPTZ(3);

CREATE INDEX "export_jobs_expires_at_idx" ON "export_jobs"("expires_at");

CREATE OR REPLACE FUNCTION forbid_history_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND pg_catalog.current_setting('app.lawful_erasure', true) OPERATOR(pg_catalog.=) 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% is immutable: % is not allowed', TG_TABLE_NAME, TG_OP;
END;
$$;
