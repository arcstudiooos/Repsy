# @kinetic/web

Next.js (App Router) web app for Kinetic: the coach workspace (`/app`) and the client portal (`/portal`).

## Scripts

Run from `apps/web` (or with `pnpm --filter @kinetic/web <script>` from the repo root).

| Script           | What it does                                         |
| ---------------- | ---------------------------------------------------- |
| `pnpm dev`       | Start the dev server on http://localhost:3000        |
| `pnpm build`     | Production build                                     |
| `pnpm start`     | Serve the production build                           |
| `pnpm lint`      | ESLint                                               |
| `pnpm typecheck` | `next typegen` then `tsc --noEmit`                   |
| `pnpm test:e2e`  | Playwright suite (starts its own DB, web and worker) |

Unit and integration tests run from the repo root with `pnpm test`.

## Design tokens and shells

- Tokens: `src/styles/tokens.css` (CSS variables, mapped into the Tailwind theme in `src/app/globals.css`) and `src/lib/tokens.ts` (same values for TypeScript, plus `contrastRatio`).
- UI primitives: `src/components/ui` (shadcn-style, Radix-based). State views: `src/components/states`.
- Shells: `src/app/app/layout.tsx` (coach) and `src/app/portal/layout.tsx` (client portal); navigation in `src/components/nav`.
