# Security review — 2026-11-06

Scope: `main` at `8bd3ff4` (the web app, worker, `packages/core`, `packages/db`, CI and deploy config) and the
production dependency tree (`pnpm audit --prod`). The review was manual code reading of every trust boundary plus
targeted searches; no dynamic scanning of a deployed environment was done.

## Summary

The baseline is strong. The PR #2 review rounds already closed most of the usual SaaS gaps, and this pass confirmed
them rather than re-opening them:

- **Tenant isolation:** every API handler runs through `apiHandler` → `withTenant` (Postgres RLS). System-scope
  (`withSystem`) use is inventoried in `packages/db/src/tenant.ts` and limited to the worker, invites, sign-up and the
  platform-admin console (which authorizes before opening the transaction).
- **AuthN:** Better Auth with DB-backed sessions, required email verification, 12-character minimum, the HIBP breached
  password check, TOTP 2FA, and sign-up gated by a pilot code (HTTP `sign-up/email` is blocked).
- **CSRF:** non-GET API calls must carry `Origin` equal to `APP_BASE_URL`; cookies are `HttpOnly`, `SameSite=Lax`,
  `Secure` on https.
- **Org switching:** the active-org cookie is HMAC-signed over `userId:orgId` and re-checked against live memberships
  on every request.
- **Uploads:** content type sniffed from the bytes (no trust in the client), per-purpose allowlists, metadata stripped
  from images, random storage keys, served back with `nosniff`, `sandbox` CSP and `attachment` for PDFs.
- **Tokens:** invite, join-link and calendar tokens are 32 random bytes and stored as hashes; export download links
  are HMAC-signed, user-bound and expire in 15 minutes.
- **Output:** React escaping throughout (the three `dangerouslySetInnerHTML` uses are static, build-time content);
  user links are `https:`-only; CSV exports guard against formula injection.
- **Errors and logs:** stack traces and `err.message` never reach responses or logs (PII); request ids instead.
- **Secrets:** none committed; `render.yaml` keeps every secret `sync: false`; production refuses short secrets.

## Findings

| #   | Severity | Finding                                                                  | Status in this PR          |
| --- | -------- | ------------------------------------------------------------------------ | -------------------------- |
| 1   | Medium   | SSRF through web-push subscription endpoints                             | **Fixed**                  |
| 2   | Medium   | Unbounded memory read of chunked upload bodies                           | **Fixed**                  |
| 3   | Low      | CI workflows run with the default (possibly write) job token             | **Fixed**                  |
| 4   | Low      | CSP does not restrict script sources                                     | Open — needs nonce work    |
| 5   | Low      | Better Auth rate limiting falls back to a shared IP bucket               | Open — needs Render config |
| 6   | Low      | Rate limits are per process                                              | Open — known, documented   |
| 7   | Low      | API routes do not re-check `emailVerified`                               | Open — hardening           |
| 8   | Info     | Custom domains are attested, not DNS-verified                            | Open — feature is off      |
| 9   | Info     | Two moderate advisories in build-time dependencies (`glob`, `minimatch`) | Open — upstream            |

### 1. SSRF through web-push subscription endpoints — Medium — fixed

`POST /api/v1/push/subscriptions` accepted any `https:` URL as the endpoint, and the `push.deliver` worker job
`POST`s to every stored endpoint each minute (`fetch` follows redirects by default). Any signed-in user, including a
client, could make the worker send requests to an arbitrary host, including internal services on the deploy network,
and learn the status code indirectly (the row is deleted on 404/410).

Fix:

- `isPushServiceEndpoint` (`packages/core/src/notifications/push.ts`) allows only https endpoints on the browser push
  services (FCM, Mozilla autopush, Apple, WNS), on the default port and without credentials.
- `savePushSubscription` and the subscribe route both enforce it; the route checks it before `releaseEndpoint` touches
  another user's row.
- `deliverPushes` never sends to a stored endpoint outside the allowlist and deletes it (covers rows saved before
  this change).
- The worker's `fetch` uses `redirect: 'manual'`.
- Tests: allowlist cases (including look-alike hosts, ports, credentials, metadata IPs), save rejection, and the
  legacy-row drop.

### 2. Unbounded memory read of chunked upload bodies — Medium — fixed

`POST /api/v1/media` checked `Content-Length` and then called `request.arrayBuffer()`. A chunked request (no
`Content-Length`) or a false header was read fully into memory before the 100 MB size check, so a few concurrent
requests could exhaust the web instance's memory.

Fix: `readBodyCapped` streams the body and stops (cancelling the stream) as soon as it passes 100 MB. Unit tests in
`apps/web/test/media-body-cap.test.ts`.

### 3. CI workflows run with the default job token — Low — fixed

`ci.yml` and `smoke.yml` had no `permissions:` block, so the `GITHUB_TOKEN` got the repository default, which can be
read/write. Both now declare `permissions: contents: read` (they only check out code).

### 4. CSP does not restrict script sources — Low — open

The CSP in `apps/web/next.config.ts` sets `frame-ancestors`, `object-src` and `base-uri` only. There is no
`script-src`, so the CSP gives no second line of defence if an XSS ever lands. No XSS was found in this review.

Recommendation: move to a nonce-based `script-src 'self' 'nonce-…' 'strict-dynamic'` set in `proxy.ts` (Next supports
nonces for its inline bootstrap), with `connect-src` listing the Sentry and PostHog hosts. Ship it as
`Content-Security-Policy-Report-Only` first.

### 5. Better Auth rate limiting falls back to a shared IP bucket — Low — open

Better Auth 1.7 trusts `X-Forwarded-For` only when it has a single value, unless `advanced.ipAddress.trustedProxies`
is set. Behind Render, a client that sends its own `X-Forwarded-For` produces a two-value header, so Better Auth
resolves no IP and uses one shared per-path bucket. That is not a bypass (the shared bucket is still limited), but one
abuser can exhaust it and lock out other clients whose requests also land there (for example users behind corporate
proxies). The app's own limiter (`server/clientIp.ts`) already handles this correctly with `TRUSTED_PROXY_HOPS`.

Recommendation: set `advanced.ipAddress.trustedProxies` to Render's proxy ranges, or use a single-value header that
Render sets and clients cannot forge, and add a test.

### 6. Rate limits are per process — Low — open

`InMemoryRateLimiter` (API, calendar feed, public forms) is per instance, as the code comments say. With more than one
web instance the effective limits multiply. Move to a shared store (Postgres or Redis) before scaling out.

### 7. API routes do not re-check `emailVerified` — Low — open

`guardRequest` sends unverified users to `/verify-email` for pages, but `apiHandler` only requires a session. Today
Better Auth will not create a session for an unverified email/password account (`requireEmailVerification: true`),
and invite acceptance marks the email verified, so there is no known path to exploit this. Rejecting unverified users
in `apiHandler` (allowing the few routes the verify flow needs) would make the rule hold at both layers.

### 8. Custom domains are attested, not DNS-verified — Info — open

`markDomainVerified` records the coach's statement that DNS is set; it does not check the TXT record. The feature is
off (`FEATURE_CUSTOM_DOMAINS`), and the worker does not use the branded sender yet. Before turning it on, verify the
TXT record server-side so a workspace cannot claim a domain it does not control.

### 9. Moderate advisories in build-time dependencies — Info — open

`pnpm audit --prod` reports two moderate advisories, both through `@sentry/bundler-plugins` (a build-time plugin):
`glob` 9.x–14.0.1 (GHSA-3g3m-2fjr-6pw4) and `minimatch` 7.x–11.0.0 (GHSA-g3hv-75wg-m249). Neither path runs on
request input at runtime. Update `@sentry/nextjs` / `@sentry/node` when Sentry ships a release on the patched
versions.

## Checked and found sound

Admin console gating (404 to non-admins, before any database access) · invite, join and team-join flows · calendar
feed (hashed token, IP-limited, titles only) · export links and file streaming · billing authorization (every core
function asserts the role; clients can cancel only their own subscription) · server actions (all resolve the actor
server-side; public ones are IP-limited) · post-login redirect (`safeNext`, same origin only) · `/api/dev/emails`
(404 in production) · the marketing-host redirect · CSV builders (formula guard; the billing CSV's only text field,
currency, is validated against ISO codes).
