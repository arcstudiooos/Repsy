-- CreateTable
CREATE TABLE "coach_profiles" (
    "user_id" UUID NOT NULL,
    "bio" TEXT,
    "specialties" TEXT[],
    "units" "units" NOT NULL DEFAULT 'kg',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "coach_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "user_id" UUID NOT NULL,
    "message_email_opt_in" BOOLEAN NOT NULL DEFAULT false,
    "marketing_opt_in" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id")
);

-- AddForeignKey
ALTER TABLE "coach_profiles" ADD CONSTRAINT "coach_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


COMMENT ON TABLE "coach_profiles" IS 'Users-level (keyed by user_id, not tenant-owned): a coach''s own profile across organizations. Forced RLS: own row only.';
COMMENT ON COLUMN "coach_profiles"."user_id" IS 'Owner user; also the primary key. RLS compares it with app.user_id.';
COMMENT ON TABLE "notification_preferences" IS 'Users-level (keyed by user_id, not tenant-owned): email opt-ins, default off. Forced RLS: own row only.';
COMMENT ON COLUMN "notification_preferences"."user_id" IS 'Owner user; also the primary key. RLS compares it with app.user_id.';

-- Row-Level Security: self-row policy keyed on the acting user (app.user_id, set by withTenant).
-- Qualified like migration 000008 so search_path shadowing cannot change the meaning.
ALTER TABLE "coach_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "coach_profiles" FORCE ROW LEVEL SECURITY;
CREATE POLICY self_row ON "coach_profiles" FOR ALL
  USING (user_id = NULLIF(pg_catalog.current_setting('app.user_id', true), '')::pg_catalog.uuid OR app_rls_bypass())
  WITH CHECK (user_id = NULLIF(pg_catalog.current_setting('app.user_id', true), '')::pg_catalog.uuid OR app_rls_bypass());

ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_preferences" FORCE ROW LEVEL SECURITY;
CREATE POLICY self_row ON "notification_preferences" FOR ALL
  USING (user_id = NULLIF(pg_catalog.current_setting('app.user_id', true), '')::pg_catalog.uuid OR app_rls_bypass())
  WITH CHECK (user_id = NULLIF(pg_catalog.current_setting('app.user_id', true), '')::pg_catalog.uuid OR app_rls_bypass());
