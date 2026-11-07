# Change management policy

**Owner:** security lead. **Review:** yearly.

1. **Every production change goes through a pull request** to `master`. No direct pushes; branch protection requires CI to pass.
2. **CI must be green:** lint, format, type checks, unit and database tests (including the row-level security check), a production build, and end-to-end tests (`.github/workflows/ci.yml`).
3. **Review.** A second person reviews and approves before merge once the team has more than one engineer. Until then, the author reviews the diff in GitHub and records the review in the pull request.
4. **Database changes** are Prisma migrations committed with the code. `pnpm db:diff` must show no drift. Destructive migrations (dropping tables or columns) say so in the pull request and have a rollback note.
5. **New tenant tables** must enable and force row-level security with the `tenant_isolation` policy, and be added to `packages/db/src/rls.test.ts`.
6. **Deploys** happen from `master` through Render. Rollback is described in `docs/runbook.md`.
7. **Emergency changes** (to stop an incident) may skip review but not CI where avoidable. They are reviewed after the fact within 2 working days and linked to the incident record.
8. **Configuration and secrets** are changed in the provider console by people with access, and the change is noted in the change or incident record (never the secret value).
9. **Client compatibility (PRD M11).** A server change must keep accepting writes queued by older app builds for at least 90 days. `apps/web/test/offline-contract.test.ts` enforces this for workout logging.
