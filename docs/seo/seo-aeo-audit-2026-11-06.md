# SEO and AEO audit: repsy.fit (2026-11-06)

Method: [claude-seo](https://github.com/AgriciDaniel/claude-seo) v2.5.0 audit flow (`fetch_page.py`, `parse_html.py`, `agentic_check.py`, the `seo-technical`, `seo-schema`, `seo-geo` and `seo-agentic` checklists), run against the live site, plus a read of the code on `main` at `8bd3ff4`. No Google Search Console, CrUX or backlink data was available, so performance and authority are not scored from field data.

Business type: B2B SaaS (online coaching software for fitness coaches). Not local, not e-commerce.

## How the site is served

One Next.js deployment answers on two hosts (`lib/marketingHost.ts`):

| Host | Serves |
| --- | --- |
| `repsy.fit` (and `www.repsy.fit`, which 301s to it) | The landing page and files with an extension (`/robots.txt`, `/sitemap.xml`, `/llms.txt`, icons). Every other path 308s to the app host. |
| `app.repsy.fit` (`APP_BASE_URL`) | Everything, including the same landing page at `/`. |

Public, indexable pages today: `/` (landing), `/signup`, `/login`, `/plan` (fair-billing charter), `/changelog`, `/status`.

## Scorecard

Categories and weights are claude-seo's; the numbers are the auditor's estimates from the checks above, not a tool output. "Before" is the live site on 2026-11-06. "After" is the expected score once this PR is deployed.

| Category (weight) | Before | After | Main reason |
| --- | --- | --- | --- |
| Technical SEO (22%) | 62 | 84 | No canonical, no sitemap, duplicate home page on two hosts |
| Content quality (23%) | 70 | 70 | Strong landing copy, but only one marketing page; no compare, pricing or feature pages yet |
| On-page SEO (20%) | 72 | 82 | Good title and description on the home page; public pages had no descriptions; the H1 text read "thatnever" |
| Schema (10%) | 45 | 85 | Only `FAQPage`; no `Organization`, `WebSite` or `SoftwareApplication` |
| Performance (10%) | n/a | n/a | No field data (CrUX). Server-rendered, fonts preloaded; measure after deploy |
| AI search readiness (10%) | 55 | 85 | No llms.txt, no deliberate AI crawler policy, no share image |
| Images (5%) | 80 | 90 | Brand mark is decorative (`alt=""` is right); no og:image |
| **Overall** | **~64** | **~79** | |

## What works already

- The landing page is server-rendered: 1,561 words are in the HTML before JavaScript runs, so every crawler and AI fetcher sees the content.
- Unknown URLs return a real 404 (no soft 404s).
- `robots.txt` keeps signed-in areas, the API and token links out of crawlers.
- Strong security headers: HSTS, `X-Frame-Options: DENY`, CSP `frame-ancestors 'none'`, referrer and permissions policies.
- One H1, a clear H2 per section, and an FAQ with `FAQPage` JSON-LD whose answers match the visible text.
- Title (51 characters) and description (147 characters) are within limits and say what the product is.
- Comparison claims cite sources with dates (`marketing-content.test.ts` enforces 120-day freshness).

## Findings and what this PR does

| # | Severity | Finding | Fix in this PR |
| --- | --- | --- | --- |
| 1 | High | **Duplicate home page.** `app.repsy.fit/` serves the full landing page with a 200 and no canonical, so it competes with `repsy.fit/`. | The home page states `<link rel="canonical" href="https://repsy.fit">` and `og:url` on both hosts. |
| 2 | High | **No canonical URLs anywhere.** | `metadataBase` is the app host; `/signup`, `/plan`, `/changelog` and `/status` declare their canonicals. |
| 3 | High | **No `sitemap.xml`** (404 on both hosts) and no `Sitemap:` line in robots.txt. | `app/sitemap.ts` lists the 5 public pages with absolute URLs. robots.txt points to `https://repsy.fit/sitemap.xml`; because the same robots.txt answers on the app host, the cross-host URLs are valid under the sitemaps protocol. |
| 4 | High | **No share image.** Links shared in Slack, LinkedIn, X or iMessage showed a text-only card (`twitter:card=summary`, no `og:image`). | `app/opengraph-image.tsx` generates a 1200x630 card from the brand tokens at build time; `twitter:card` is now `summary_large_image`. |
| 5 | Medium | **Missing entity schema.** Answer engines and Google's knowledge panel need to know who makes Repsy and what it costs. | `Organization`, `WebSite` and `SoftwareApplication` (with one `Offer` per plan, prices read from the same `PLANS` the pricing section renders) in one `@graph` on the home page. No ratings or review counts: there are none yet (landing PRD §3.2). |
| 6 | Medium | **No `/llms.txt`.** Lighthouse counts it in Agentic Browsing; AI agents use it as a map. | `/llms.txt` built from `content/marketing.ts` (promises, plans, trust, FAQ, links). Unshipped promises are labelled "(coming soon)", and a test checks it. |
| 7 | Medium | **AI crawlers fall through to `*`.** Not wrong, but the policy is implicit. | Named group for AI search and user agents (OAI-SearchBot, ChatGPT-User, Claude-SearchBot, Claude-User, PerplexityBot, Perplexity-User) with the same rules. Training crawlers are untouched (see decision D1). |
| 8 | Medium | **H1 text is "Coaching software thatnever drops the ball."** The two lines are block spans with no space between them, so raw-HTML readers (most AI crawlers) and snippets get a run-together word. | A real space between the spans. No visual change. |
| 9 | Low | Public pages (`/signup`, `/plan`, `/changelog`, `/status`) had a title but no meta description, so search engines wrote their own. | Descriptions added, each using only claims the page already makes. |
| 10 | Low | No `og:site_name`, `og:locale` or `applicationName`. | Set in the root layout. |

## Not in this PR (recommended next)

Ordered by impact. Items 1 to 4 are the biggest SEO opportunity: today there is one page that can rank.

1. **Build the rest of the landing PRD sitemap** (`docs/landing/repsy-landing-prd.md` §5): `/pricing`, `/features`, `/switch`, the `/compare` hub and the five `/compare/<competitor>` pages, the four `/coaches/*` solution pages, `/security`, `/about`, `/contact`. Compare pages target "<competitor> alternative" and "<competitor> vs Repsy", the highest-intent queries for a switcher product. Each new page: add it to `sitemap.ts`, give it a unique title, description and canonical, and add `BreadcrumbList` JSON-LD (plus `FAQPage` where it has an FAQ).
2. **Decide where marketing pages live.** Today `lib/marketingHost.ts` redirects every path except `/` off `repsy.fit`. New marketing pages should be served on `repsy.fit` (add them to `servesOnMarketingHost`), so the brand domain collects the authority, and then their canonical should be the `repsy.fit` URL. `/plan` and `/changelog` are good candidates to move now.
3. **Legal pages.** When PR #11 (`/privacy`, `/terms`) merges, add both to `PUBLIC_APP_PATHS` in `lib/site.ts` so they appear in the sitemap.
4. **Verify both hosts in Google Search Console and Bing Webmaster Tools**, submit `https://repsy.fit/sitemap.xml`, and check that Google picks `repsy.fit/` as the canonical for the home page. Bing powers ChatGPT Search and Copilot results, so it matters for AEO.
5. **Measure Core Web Vitals after deploy** (PageSpeed Insights on mobile; PRD targets LCP < 2.0 s, CLS < 0.05, INP < 150 ms). The landing page streams behind a session check (`Suspense` in `app/page.tsx`); confirm that does not delay LCP for signed-out visitors.
6. **Answer-first copy for AEO.** Add one 40 to 60 word paragraph near the top that answers "What is Repsy?" in plain terms (who it is for, what it does, price from). AI answer engines quote self-contained passages; the hero is a slogan, not an answer.
7. **Brand mentions.** AI answer engines weight third-party mentions (G2, Capterra, Product Hunt, Reddit coaching communities, YouTube) more than on-site signals. List Repsy on G2 and Capterra once pilot coaches agree to review it.
8. **Optional:** a `Content-Signal` line in robots.txt (Next's `robots.ts` cannot emit custom lines, so this needs a route handler), IndexNow pings on deploy for Bing, and a Markdown alternate of the home page.

## Decisions for the owner

- **D1. AI training crawlers.** GPTBot, ClaudeBot, Google-Extended, CCBot and Applebot-Extended are allowed today (they fall under `*`). Allowing them helps Repsy show up in model answers; blocking them keeps the copy out of training sets. This PR does not change that. To block, add a group for them with `disallow: '/'` in `app/robots.ts`.
- **D2. Build-time environment.** Metadata is prerendered, so `MARKETING_HOSTS` and `APP_BASE_URL` must be set at build time on Render (they are runtime variables today and Render exposes them to builds). Without `MARKETING_HOSTS`, canonicals fall back to the app host, which is still consistent.
