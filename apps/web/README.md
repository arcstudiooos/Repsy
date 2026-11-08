# @repsy/web

Next.js (App Router) web app for Repsy: the coach workspace (`/app`) and the client portal (`/portal`).

## Scripts

Run from `apps/web` (or with `pnpm --filter @repsy/web <script>` from the repo root).

| Script           | What it does                                         |
| ---------------- | ---------------------------------------------------- |
| `pnpm dev`       | Start the dev server on http://localhost:3000        |
| `pnpm build`     | Production build                                     |
| `pnpm start`     | Serve the production build                           |
| `pnpm lint`      | ESLint                                               |
| `pnpm typecheck` | `next typegen` then `tsc --noEmit`                   |
| `pnpm test:e2e`  | Playwright suite (starts its own DB, web and worker) |

Unit and integration tests run from the repo root with `pnpm test`.

### E2E isolation

`pnpm test:e2e` never touches a running `pnpm dev`:

- it builds into `.next-e2e` (`NEXT_DIST_DIR`), not `.next`; to start it clean, delete `apps/web/.next-e2e` (never `.next`, which belongs to the dev server);
- it serves on port 3200 (worker health on 8281); override with `E2E_WEB_PORT` / `E2E_WORKER_PORT`;
- it creates and drops its own `repsy_e2e` database (or an embedded Postgres when `DATABASE_URL` is unset), never the dev database.

A one-off production build check that should not disturb a dev server can use its own dir too: `NEXT_DIST_DIR=.next-build pnpm build`.

## Design tokens and shells

- Tokens: `src/styles/tokens.css` (CSS variables, mapped into the Tailwind theme in `src/app/globals.css`) and `src/lib/tokens.ts` (same values for TypeScript, plus `contrastRatio`).
- UI primitives: `src/components/ui` (shadcn-style, Radix-based). State views: `src/components/states`.
- Shells: `src/app/app/layout.tsx` (coach) and `src/app/portal/layout.tsx` (client portal); navigation in `src/components/nav`.
