/**
 * Public URLs for SEO (canonical links, sitemap, robots, structured data, llms.txt).
 *
 * Repsy runs on two hosts from one deployment: the marketing host (repsy.fit) serves only the landing page, and
 * the app host (APP_BASE_URL, e.g. app.repsy.fit) serves everything else (see lib/marketingHost.ts). The same home
 * page also answers on the app host, so every page states its canonical URL on the host that should rank.
 *
 * Metadata is prerendered, so these must be set at build time as well as at runtime (Render sets both).
 */

type SiteEnv = {
  MARKETING_HOSTS?: string;
  APP_BASE_URL?: string;
  BETTER_AUTH_URL?: string;
};

export const SITE_NAME = 'Repsy';
export const SITE_TAGLINE = 'Coaching software that never drops the ball';
export const SITE_DESCRIPTION =
  "Programs, check-ins, messages and scheduling for online and hybrid coaches. Clients' logs save with no signal, and every feature is on every plan.";
export const CONTACT_EMAIL = 'hello@repsy.fit';

const LOCAL = 'http://localhost:3000';

/** An absolute origin without a trailing slash, or null if the value is not an http(s) URL. */
function origin(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

/** Where the app lives: APP_BASE_URL, else the auth URL, else local dev. */
export function appUrlFrom(env: SiteEnv): string {
  return origin(env.APP_BASE_URL) ?? origin(env.BETTER_AUTH_URL) ?? LOCAL;
}

/**
 * Where the landing page should rank: the first MARKETING_HOSTS entry (served over https, as Render does), else
 * the app URL. Single-host setups therefore get one consistent origin.
 */
export function siteUrlFrom(env: SiteEnv): string {
  const host = (env.MARKETING_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .find(Boolean);
  return (host && origin(`https://${host}`)) || appUrlFrom(env);
}

const env: SiteEnv = {
  MARKETING_HOSTS: process.env.MARKETING_HOSTS,
  APP_BASE_URL: process.env.APP_BASE_URL,
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
};
export const siteUrl = siteUrlFrom(env);
export const appUrl = appUrlFrom(env);

/** Pages on the app host that are public and worth indexing (everything else is signed-in or token-only). */
export const PUBLIC_APP_PATHS = ['/signup', '/plan', '/changelog', '/status'] as const;

/** Signed-in areas, the API and token links (invites, calendar feeds): never crawled (QA 2026-11-06). */
export const PRIVATE_PATHS = [
  '/app',
  '/portal',
  '/admin',
  '/api/',
  '/settings',
  '/onboarding',
  '/select-org',
  '/invite/',
  '/team/',
  '/calendar/',
  '/verify-email',
  '/reset-password',
];

/**
 * AI search and answer engines, named in robots.txt so the policy is deliberate rather than a fall-through to `*`
 * (SEO/AEO audit 2026-11-06). They get the same rules as everyone else. Training-only crawlers (GPTBot, ClaudeBot,
 * Google-Extended, CCBot, Applebot-Extended) stay on the `*` group: blocking them is a business call, not SEO.
 */
export const AI_SEARCH_AGENTS = [
  'OAI-SearchBot',
  'ChatGPT-User',
  'Claude-SearchBot',
  'Claude-User',
  'PerplexityBot',
  'Perplexity-User',
];
