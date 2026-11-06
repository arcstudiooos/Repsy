import type { MetadataRoute } from 'next';

/**
 * Crawl rules (QA 2026-11-06): the landing page and public pages may be indexed; signed-in areas, the API and
 * token links (invites, calendar feeds) may not.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
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
      ],
    },
  };
}
