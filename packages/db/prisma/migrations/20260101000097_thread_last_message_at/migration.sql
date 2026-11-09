-- The inbox sorts and pages on the newest message's time, so it no longer reads every thread (launch hardening).
ALTER TABLE "conversation_threads" ADD COLUMN "last_message_at" TIMESTAMPTZ(3);

-- Row-level security is forced on these tables, including for the owner running this migration.
SELECT set_config('app.bypass_rls', 'on', true);
UPDATE "conversation_threads" t
SET "last_message_at" = m."newest"
FROM (SELECT "thread_id", MAX("created_at") AS "newest" FROM "messages" GROUP BY "thread_id") m
WHERE m."thread_id" = t."id";
