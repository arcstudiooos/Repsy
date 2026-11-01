-- PRD M8 (D-011 #7): incident and maintenance notices a platform admin posts. Shown as a banner in the app and on
-- the public status page, with past ones as the incident history. Platform-wide: no organization, read and written in
-- system scope only.
CREATE TABLE "platform_notices" (
    "id" UUID NOT NULL,
    "severity" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(3),
    "postmortem" TEXT,

    CONSTRAINT "platform_notices_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "platform_notices_created_at_idx" ON "platform_notices"("created_at");
ALTER TABLE "platform_notices" ADD CONSTRAINT "platform_notices_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "platform_notices" ADD CONSTRAINT "platform_notices_check" CHECK (
  "severity" IN ('maintenance', 'degraded', 'outage')
  AND char_length("message") BETWEEN 1 AND 300
  AND ("postmortem" IS NULL OR char_length("postmortem") <= 5000)
);
ALTER TABLE "platform_notices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_notices" FORCE ROW LEVEL SECURITY;
CREATE POLICY system_only ON "platform_notices" FOR ALL USING (app_rls_bypass()) WITH CHECK (app_rls_bypass());
