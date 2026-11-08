# Technical controls in place

The controls below exist in the product today. Each row names where it lives, so an auditor or tester can verify it. Keep this list true: when a control changes, update the row in the same pull request.

## Identity and access

| Control            | Detail                                                                                                                                                                                                          | Where                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Password policy    | At least 12 characters; every new password is checked against known breaches (Have I Been Pwned, k-anonymity API). The check cannot be turned off in production.                                                | `apps/web/src/lib/auth.ts`, `auth-env.ts`                   |
| Email verification | Required before first sign-in.                                                                                                                                                                                  | `apps/web/src/lib/auth.ts`                                  |
| Two-step sign-in   | Authenticator app codes with backup codes (PRD A8). Required for every staff member once a workspace has more than one coach.                                                                                   | `packages/core/src/identity/twoFactor.ts`                   |
| Single sign-on     | Google Workspace or Microsoft Entra ID per workspace (PRD A16). Optional enforcement blocks password sign-in for staff on the domain. Microsoft links are checked against the workspace's directory id.         | `packages/core/src/identity/sso.ts`                         |
| Sessions           | Stored server-side and revocable; 7-day lifetime; HttpOnly, SameSite=Lax, Secure cookies over HTTPS. Users can sign out other devices.                                                                          | `apps/web/src/lib/auth.ts`, `server/routes/sessions.ts`     |
| Sign-up gate       | New coach accounts need a pilot code; HTTP sign-up and implicit social sign-up are blocked.                                                                                                                     | `apps/web/src/lib/auth.ts`                                  |
| Role-based access  | Every domain function checks a named permission (`assertCan`) against the actor's role: owner, admin, coach, assistant, client.                                                                                 | `packages/core/src/authz/policies.ts`                       |
| Support access     | A Repsy platform admin can read a client's data only after recording a reason on `/admin`; the grant lasts 24 hours and can be revoked. Every grant, revoke and read is audited against the client's workspace. | `support_access_grants`, `docs/runbook.md` (Support access) |

## Data isolation and protection

| Control                 | Detail                                                                                                                                                               | Where                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Tenant isolation        | Every tenant table has row-level security enabled and forced, with a `tenant_isolation` policy on `app_current_org()`. A test fails the build if any table lacks it. | `packages/db/prisma/migrations`, `packages/db/src/rls.test.ts` |
| Least-privilege DB role | The app connects as `repsy_app`, which cannot bypass RLS; migrations run as the owner.                                                                             | `docs/runbook.md` (Database roles)                             |
| Encryption in transit   | HTTPS only; HSTS for two years including subdomains.                                                                                                                 | `apps/web/next.config.ts`                                      |
| Encryption at rest      | Managed Postgres and Cloudflare R2 encrypt at rest. Calendar refresh tokens are also encrypted in the app with AES-256-GCM.                                          | `packages/core/src/calendar/tokenCrypto.ts`                    |
| Private files           | Uploads live in private R2 storage and are served only through an authorised API route.                                                                              | `server/routes/media.ts`                                       |
| Deletion                | Client erasure removes their records across tables (PRD privacy journey E), done within 30 days. Backups expire within 35 days.                                      | `packages/core/src/privacy/deletion.ts`                        |
| Offline data on devices | The portal's device store is bound to one user and wiped on sign-out or when another user signs in.                                                                  | `apps/web/src/portal/offline/db.ts`                            |

## Application security

| Control          | Detail                                                                                                                     | Where                                                   |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Input validation | Every API body and query is parsed with a Zod schema; unknown keys are dropped.                                            | `apps/web/src/server/api.ts`                            |
| CSRF             | State-changing requests must come from the app's own origin.                                                               | `apps/web/src/server/api.ts`                            |
| Rate limiting    | Sign-in and auth endpoints (database-backed), plus per-route limits on sensitive API routes.                               | `apps/web/src/lib/auth.ts`, `server/rateLimit.ts`       |
| Security headers | Content Security Policy, `X-Frame-Options: DENY`, `Referrer-Policy`, HSTS.                                                 | `apps/web/next.config.ts`                               |
| AI assistant     | Off by default; read-only tools, plus proposals only when a manager turns actions on; every proposal needs the asking coach's Confirm, runs through the domain functions with their permissions and is audited; workspace data goes to OpenAI only when a manager turns it on; no training on it. | `packages/core/src/ai`, `apps/web/src/server/assistant` |
| Errors           | Error responses carry a request id, never a stack trace.                                                                   | `apps/web/src/server/api.ts`                            |

## Operations

| Control                  | Detail                                                                                                                                     | Where                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| Change management        | All changes go through pull requests; CI runs lint, format, type checks, unit and database tests, a production build and end-to-end tests. | `.github/workflows/ci.yml`                                     |
| Dependency updates       | Dependabot opens weekly update pull requests for npm packages and GitHub Actions.                                                          | `.github/dependabot.yml`                                       |
| Audit log                | Owners see who changed what, and when.                                                                                                     | `packages/core/src/audit/ownerLog.ts`                          |
| Monitoring               | Errors go to Sentry; structured JSON logs with request ids.                                                                                | `packages/core/src/log.ts`, `apps/web/src/server/requestId.ts` |
| Backups                  | Daily managed backups, retention 35 days or less, quarterly restore drill.                                                                 | `docs/runbook.md` (Backups and restore)                        |
| Vulnerability disclosure | Public policy and contact.                                                                                                                 | `SECURITY.md`                                                  |
