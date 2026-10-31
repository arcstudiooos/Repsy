import { join } from 'node:path';
import type { NextConfig } from 'next';

/**
 * Local dev: load the repo-root `.env` (Node's built-in loader, the same one the
 * worker and db scripts use via --env-file-if-exists; that flag cannot be used
 * here because Next forwards execArgv into NODE_OPTIONS). Variables already in
 * the environment win. Hosted builds have no `.env`; the E2E stack opts out
 * with KINETIC_DOTENV=off so it runs only on the environment it sets.
 */
if (process.env.KINETIC_DOTENV !== 'off') {
  try {
    process.loadEnvFile(join(import.meta.dirname, '..', '..', '.env'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

/**
 * This build's id, for the portal service worker's cache names (PR #2 review follow-up): the deployed commit on
 * Render, KINETIC_BUILD_ID when set, otherwise the build time. A new id installs a new worker, which drops the
 * previous build's asset cache.
 */
const buildId = (
  process.env.KINETIC_BUILD_ID?.trim() ||
  process.env.RENDER_GIT_COMMIT?.trim().slice(0, 12) ||
  `t${Date.now().toString(36)}`
).replace(/[^A-Za-z0-9_-]/g, '');

const nextConfig: NextConfig = {
  // The E2E stack (and ad-hoc build checks) use their own build dir so they never share `.next` with `next dev`.
  distDir: process.env.NEXT_DIST_DIR?.trim() || '.next',
  env: { NEXT_PUBLIC_BUILD_ID: buildId },
  cacheComponents: true,
  transpilePackages: ['@kinetic/core', '@kinetic/db'],
  serverExternalPackages: ['pg'],
  partialPrefetching: true,
  // The portal service worker (S3-3): always revalidated, so a new version is picked up on the next visit.
  async headers() {
    return [
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
