/**
 * The bare domain (repsy.fit, www.repsy.fit) only serves the landing page. Everything else (sign-up, log-in, the
 * app, links in emails) lives on APP_BASE_URL, so accounts and session cookies stay on one host. Hosts come from
 * MARKETING_HOSTS (comma-separated); unset means no redirects.
 */

/** Paths a marketing host serves itself: the home page, Next's assets and files with an extension (icons, robots). */
const servesOnMarketingHost = (pathname: string): boolean =>
  pathname === '/' || pathname.startsWith('/_next/') || /\/[^/]+\.[a-z0-9]+$/i.test(pathname);

export const parseHosts = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);

/** The request's public host, without a port. Render puts it in Host (and X-Forwarded-Host behind proxies). */
export const requestHost = (headers: Headers): string =>
  (headers.get('x-forwarded-host') ?? headers.get('host') ?? '')
    .split(',')[0]!
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, '');

/** The app URL to send this request to, or null when it should be served where it is. */
export function marketingHostRedirect(
  host: string,
  pathname: string,
  search: string,
  env: { marketingHosts: string[]; appBaseUrl: string | undefined },
): string | null {
  if (!env.appBaseUrl || !env.marketingHosts.includes(host)) return null;
  if (servesOnMarketingHost(pathname)) return null;
  return `${env.appBaseUrl.replace(/\/+$/, '')}${pathname}${search}`;
}
