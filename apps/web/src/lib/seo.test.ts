import { describe, expect, it } from 'vitest';
import robots from '@/app/robots';
import sitemap from '@/app/sitemap';
import { FAQ, PLANS, PROMISES } from '@/content/marketing';
import { llmsTxt } from './llmsTxt';
import { AI_SEARCH_AGENTS, appUrlFrom, PRIVATE_PATHS, siteUrlFrom } from './site';
import { homeJsonLd, jsonLdScript } from './structuredData';

describe('site URLs', () => {
  const prod = {
    MARKETING_HOSTS: ' Repsy.fit, www.repsy.fit',
    APP_BASE_URL: 'https://app.repsy.fit/',
    BETTER_AUTH_URL: 'https://app.repsy.fit',
  };

  it('ranks the landing page on the first marketing host and the rest on the app host', () => {
    expect(siteUrlFrom(prod)).toBe('https://repsy.fit');
    expect(appUrlFrom(prod)).toBe('https://app.repsy.fit');
  });

  it('falls back to one host when there is no marketing host', () => {
    const single = { APP_BASE_URL: 'https://staging.example.com/x' };
    expect(siteUrlFrom(single)).toBe('https://staging.example.com');
    expect(appUrlFrom(single)).toBe('https://staging.example.com');
    expect(appUrlFrom({ BETTER_AUTH_URL: 'http://localhost:3100' })).toBe('http://localhost:3100');
  });

  it('ignores values that are not http(s) URLs', () => {
    expect(appUrlFrom({ APP_BASE_URL: 'not a url', BETTER_AUTH_URL: 'ftp://x' })).toBe(
      'http://localhost:3000',
    );
  });
});

describe('robots.txt', () => {
  const r = robots();
  const rules = Array.isArray(r.rules) ? r.rules : [r.rules];

  it('keeps private areas out for everyone, AI search agents included', () => {
    expect(rules).toHaveLength(2);
    for (const rule of rules) {
      expect(rule.allow).toBe('/');
      expect(rule.disallow).toEqual(PRIVATE_PATHS);
    }
    expect(rules[1]!.userAgent).toEqual(AI_SEARCH_AGENTS);
    for (const p of ['/app', '/portal', '/api/', '/invite/', '/calendar/']) {
      expect(PRIVATE_PATHS).toContain(p);
    }
  });

  it('points to the sitemap with an absolute URL', () => {
    expect(r.sitemap).toMatch(/^https?:\/\/[^/]+\/sitemap\.xml$/);
  });
});

describe('sitemap.xml', () => {
  const urls = sitemap().map((e) => new URL(e.url));

  it('lists the home page first and only public pages', () => {
    expect(urls[0]!.pathname).toBe('/');
    expect(urls.map((u) => u.pathname)).toEqual(['/', '/signup', '/plan', '/changelog', '/status']);
    for (const u of urls) {
      expect(PRIVATE_PATHS.some((p) => u.pathname.startsWith(p))).toBe(false);
    }
  });
});

describe('home page JSON-LD', () => {
  const site = 'https://repsy.fit';
  const graph = homeJsonLd(site)['@graph'];
  const byType = (t: string) => graph.find((n) => n['@type'] === t) as Record<string, unknown>;

  it('describes the organization, the site and the product', () => {
    expect(graph.map((n) => n['@type'])).toEqual([
      'Organization',
      'WebSite',
      'SoftwareApplication',
    ]);
    expect(byType('Organization').url).toBe('https://repsy.fit/');
    expect(byType('WebSite').publisher).toEqual({ '@id': 'https://repsy.fit/#organization' });
  });

  it('offers exactly the plans and prices the pricing section shows, and no ratings', () => {
    const app = byType('SoftwareApplication');
    const offers = app.offers as { name: string; price: string; priceCurrency: string }[];
    expect(offers.map((o) => [o.name, o.price])).toEqual(
      PLANS.map((p) => [p.name, String(p.monthly)]),
    );
    expect(offers.every((o) => o.priceCurrency === 'USD')).toBe(true);
    expect(app).not.toHaveProperty('aggregateRating');
    expect(app).not.toHaveProperty('review');
  });

  it('cannot break out of its script tag', () => {
    expect(jsonLdScript({ a: '</script><script>x' })).not.toContain('</script>');
  });
});

describe('llms.txt', () => {
  const text = llmsTxt('https://repsy.fit', 'https://app.repsy.fit');

  it('follows llmstxt.org: an H1, a summary quote, then Markdown links', () => {
    const lines = text.split('\n');
    expect(lines[0]).toBe('# Repsy');
    expect(lines[2]).toMatch(/^> /);
    expect(text).toContain('[Start free trial](https://app.repsy.fit/signup)');
    expect(text).toContain('[Home](https://repsy.fit/)');
  });

  it('says only what the landing page says, and labels unshipped promises', () => {
    for (const f of FAQ) expect(text).toContain(f.a);
    for (const p of PROMISES) {
      const line = text.split('\n').find((l) => l.startsWith(`- ${p.title}`));
      expect(line).toBeDefined();
      expect(line!.includes('(coming soon)')).toBe(Boolean(p.soon));
    }
  });
});
