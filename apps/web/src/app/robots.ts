import type { MetadataRoute } from 'next';
import { AI_SEARCH_AGENTS, PRIVATE_PATHS, siteUrl } from '@/lib/site';

/**
 * Crawl rules (QA 2026-11-06): the landing page and public pages may be indexed; signed-in areas, the API and
 * token links (invites, calendar feeds) may not. AI search agents are named with the same rules (SEO/AEO audit
 * 2026-11-06).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: PRIVATE_PATHS },
      { userAgent: AI_SEARCH_AGENTS, allow: '/', disallow: PRIVATE_PATHS },
    ],
    // The same robots.txt answers on the app host too, which makes this a valid cross-host sitemap reference.
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
