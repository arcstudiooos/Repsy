import { PLANS } from '@/content/marketing';
import { CONTACT_EMAIL, SITE_DESCRIPTION, SITE_NAME, siteUrl as defaultSiteUrl } from '@/lib/site';

/**
 * Schema.org JSON-LD for the home page (SEO/AEO audit 2026-11-06): who makes Repsy (Organization), the site
 * (WebSite) and the product with its real plan prices (SoftwareApplication). Prices come from the same PLANS the
 * pricing section renders, so the markup cannot drift from the page. No ratings or review counts: there are none
 * to show yet (landing PRD §3.2).
 */
export function homeJsonLd(siteUrl: string = defaultSiteUrl) {
  const orgId = `${siteUrl}/#organization`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': orgId,
        name: SITE_NAME,
        url: `${siteUrl}/`,
        logo: `${siteUrl}/brand/repsy-mark.png`,
        email: CONTACT_EMAIL,
      },
      {
        '@type': 'WebSite',
        '@id': `${siteUrl}/#website`,
        name: SITE_NAME,
        url: `${siteUrl}/`,
        inLanguage: 'en',
        publisher: { '@id': orgId },
      },
      {
        '@type': 'SoftwareApplication',
        '@id': `${siteUrl}/#software`,
        name: SITE_NAME,
        description: SITE_DESCRIPTION,
        url: `${siteUrl}/`,
        applicationCategory: 'BusinessApplication',
        applicationSubCategory: 'Fitness coaching software',
        operatingSystem: 'Web browser (installable on iOS and Android)',
        publisher: { '@id': orgId },
        offers: PLANS.map((p) => ({
          '@type': 'Offer',
          name: p.name,
          description: `${p.blurb} Up to ${p.clients} clients, ${p.seats} ${p.seats === 1 ? 'coach seat' : 'coach seats'}.`,
          price: String(p.monthly),
          priceCurrency: 'USD',
          ...(p.monthly > 0 && {
            priceSpecification: {
              '@type': 'UnitPriceSpecification',
              price: String(p.monthly),
              priceCurrency: 'USD',
              unitCode: 'MON',
              billingDuration: 'P1M',
            },
          }),
          url: `${siteUrl}/#pricing`,
        })),
      },
    ],
  };
}

/** JSON for a `<script type="application/ld+json">`, with `<` escaped so content can never close the tag. */
export const jsonLdScript = (data: unknown): string =>
  JSON.stringify(data).replace(/</g, '\\u003c');
