-- PRD A8: two-step sign-in (Better Auth two-factor plugin): an authenticator app code (TOTP) or a one-time backup code.
-- Like accounts, two_factors is read and written only by the auth pool; the secret and backup codes are encrypted by
-- Better Auth with BETTER_AUTH_SECRET before they are stored.
ALTER TABLE "users" ADD COLUMN "two_factor_enabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "two_factors" (
    "id" UUID NOT NULL,
    "secret" TEXT NOT NULL,
    "backup_codes" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "verified" BOOLEAN DEFAULT true,
    "failed_verification_count" INTEGER DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),

    CONSTRAINT "two_factors_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "two_factors_user_id_idx" ON "two_factors"("user_id");
CREATE INDEX "two_factors_secret_idx" ON "two_factors"("secret");

ALTER TABLE "two_factors" ADD CONSTRAINT "two_factors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
