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

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  transpilePackages: ['@kinetic/core', '@kinetic/db'],
  serverExternalPackages: ['pg'],
  partialPrefetching: true,
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
