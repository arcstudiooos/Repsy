/**
 * Feature switches for work that is built but on hold. Each is OFF unless its env var is exactly "true".
 * While off, the feature's pages and API answer 404 as if they did not exist; its data and code stay intact.
 */
const FEATURE_ENV = {
  /** PRD L4 custom domains and branded sending. On hold (D-015): the planned host plan allows ~2 domains. */
  customDomains: 'FEATURE_CUSTOM_DOMAINS',
} as const;

export type FeatureName = keyof typeof FEATURE_ENV;

export function featureEnabled(
  name: FeatureName,
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env[FEATURE_ENV[name]] === 'true';
}
