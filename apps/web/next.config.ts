import { join } from 'node:path';
import type { NextConfig } from 'next';

/**
 * Local dev: load the repo-root `.env` (Node's built-in loader, the same one the
 * worker and db scripts use via --env-file-if-exists; that flag cannot be used
 * here because Next forwards execArgv into NODE_OPTIONS). Variables already in
 * the environment win. Hosted builds have no `.env`; the E2E stack opts out
 * with REPSY_DOTENV=off so it runs only on the environment it sets.
 */
if (process.env.REPSY_DOTENV !== 'off') {
  try {
    process.loadEnvFile(join(import.meta.dirname, '..', '..', '.env'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

/**
 * This build's id, for the portal service worker's cache names (PR #2 review follow-up): the deployed commit on
 * Render, REPSY_BUILD_ID when set, otherwise the build time. A new id installs a new worker, which drops the
 * previous build's asset cache.
 */
const buildId = (
  process.env.REPSY_BUILD_ID?.trim() ||
  process.env.RENDER_GIT_COMMIT?.trim().slice(0, 12) ||
  `t${Date.now().toString(36)}`
).replace(/[^A-Za-z0-9_-]/g, '');

const SECURITY_HEADERS = [
  {
    key: 'Content-Security-Policy',
    value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
  },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()',
  },
  // Browsers ignore HSTS over plain http, so this is harmless in local dev.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];

const nextConfig: NextConfig = {
  // The E2E stack (and ad-hoc build checks) use their own build dir so they never share `.next` with `next dev`.
  distDir: process.env.NEXT_DIST_DIR?.trim() || '.next',
  env: { NEXT_PUBLIC_BUILD_ID: buildId },
  cacheComponents: true,
  transpilePackages: ['@repsy/core', '@repsy/db'],
  serverExternalPackages: ['pg'],
  // Off: when on, every dynamic page rendered twice per request and doubled its database work (D-024).
  partialPrefetching: false,
  poweredByHeader: false,
  async headers() {
    return [
      // Baseline security headers on every response. The CSP only restricts framing, plugins and <base>:
      // script/style sources stay open because Next inlines bootstrap scripts and Sentry/PostHog are
      // optional. Tighten with nonces later.
      {
        source: '/:path*',
        headers: SECURITY_HEADERS,
      },
      // The portal service worker (S3-3): always revalidated, so a new version is picked up on the next visit.
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache' },
          { key: 'Service-Worker-Allowed', value: '/portal' },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
};

export default nextConfig;
