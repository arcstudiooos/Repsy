import type { MetadataRoute } from 'next';
import { appUrl, PUBLIC_APP_PATHS, siteUrl } from '@/lib/site';

/**
 * Public, indexable pages (SEO/AEO audit 2026-11-06). The home page is listed on the marketing host; the other
 * public pages only exist on the app host. No lastModified: a made-up date is worse than none.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${siteUrl}/`, changeFrequency: 'weekly', priority: 1 },
    ...PUBLIC_APP_PATHS.map((path) => ({
      url: `${appUrl}${path}`,
      changeFrequency: path === '/changelog' ? ('weekly' as const) : ('monthly' as const),
      priority: path === '/signup' ? 0.8 : 0.5,
    })),
  ];
}
