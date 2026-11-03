-- Final R3 review fixes (D-013 amendments).
--
-- M12: an ended trial now lapses 14 days after it ends (with a warning meanwhile). Trials that had already ended
-- before this release would otherwise lapse at once, so their end moves to now: they stay ended (no new clients),
-- and lapse 14 days from this migration.
UPDATE "organizations" SET "trial_ends_at" = CURRENT_TIMESTAMP
 WHERE "plan" = 'trial' AND "trial_ends_at" < CURRENT_TIMESTAMP;

-- L4: a hostname is only reserved once proved (an unproven claim never blocks the real owner); a removed domain
-- stays as a row until the worker has released it at the email provider; consecutive failed checks are counted so
-- one DNS hiccup never takes a verified domain offline.
ALTER TABLE "custom_domains" ADD COLUMN "missed_checks" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "custom_domains" DROP CONSTRAINT "custom_domains_check";
ALTER TABLE "custom_domains" ADD CONSTRAINT "custom_domains_check" CHECK (
  "hostname" ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
  AND length("hostname") <= 253
  AND "verify_token" ~ '^[a-f0-9]{32}$'
  AND "status" IN ('pending', 'verified', 'failed', 'removed')
  AND "sending_status" IN ('none', 'pending', 'verified', 'failed')
  AND "missed_checks" >= 0
);
DROP INDEX "custom_domains_hostname_key";
CREATE UNIQUE INDEX "custom_domains_verified_hostname_key" ON "custom_domains"("hostname") WHERE "status" = 'verified';
CREATE INDEX "custom_domains_hostname_idx" ON "custom_domains"("hostname");
DROP INDEX "custom_domains_organization_id_key";
CREATE UNIQUE INDEX "custom_domains_live_organization_id_key" ON "custom_domains"("organization_id") WHERE "status" <> 'removed';
CREATE INDEX "custom_domains_organization_id_idx" ON "custom_domains"("organization_id");

-- The host lookup now tells a known-but-not-serving custom host (empty string: redirect it to the app) from an
-- unknown one (null: leave it alone).
DO $do$
BEGIN
  EXECUTE pg_catalog.format($f$
    CREATE OR REPLACE FUNCTION %1$I.app_public_slug_by_host(target text)
      RETURNS text
      LANGUAGE sql STABLE
      SET app.bypass_rls = 'on'
      SET search_path = %1$I, pg_temp
      AS $body$
        SELECT COALESCE(
          (SELECT o.public_slug FROM %1$I.custom_domains d
             JOIN %1$I.organizations o ON o.id OPERATOR(pg_catalog.=) d.organization_id
            WHERE d.hostname OPERATOR(pg_catalog.=) target
              AND d.status OPERATOR(pg_catalog.=) 'verified'
              AND o.public_page_enabled
            LIMIT 1),
          (SELECT '' FROM %1$I.custom_domains d
            WHERE d.hostname OPERATOR(pg_catalog.=) target
              AND d.status OPERATOR(pg_catalog.<>) 'removed'
            LIMIT 1)
        )
      $body$
  $f$, pg_catalog.current_schema());
END
$do$;
