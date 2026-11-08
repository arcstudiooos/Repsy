import { FAQ, PLAN_CONTACT, PLANS, PROMISES, TRUST } from '@/content/marketing';
import {
  appUrl,
  CONTACT_EMAIL,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TAGLINE,
  siteUrl,
} from '@/lib/site';

/**
 * /llms.txt (llmstxt.org): a plain Markdown summary of Repsy for AI answer engines and agents (SEO/AEO audit
 * 2026-11-06). Built from the same content the landing page renders, so it only says what the page says; promises
 * marked `soon` are labelled as coming, never as shipped. Search engines ignore this file; it costs nothing.
 */
export function llmsTxt(site: string = siteUrl, app: string = appUrl): string {
  const price = (monthly: number) => (monthly === 0 ? 'free' : `$${monthly}/month`);
  const lines = [
    `# ${SITE_NAME}`,
    '',
    `> ${SITE_NAME} is online coaching software for fitness coaches. ${SITE_TAGLINE}. ${SITE_DESCRIPTION}`,
    '',
    'Coaches build programs, review logged workouts and check-ins, message clients and run sessions. Clients use it',
    'in the browser, can install it on their home screen, and can log workouts offline.',
    '',
    '## Promises',
    '',
    ...PROMISES.map((p) => `- ${p.title}${p.soon ? ' (coming soon)' : ''} ${p.body}`),
    '',
    '## Plans',
    '',
    'Every feature is on every plan. Plans differ by client count and coach seats only. Prices in USD.',
    '',
    ...PLANS.map(
      (p) =>
        `- ${p.name}: ${price(p.monthly)}, up to ${p.clients} clients, ${p.seats} ${p.seats === 1 ? 'coach seat' : 'coach seats'}. ${p.blurb}`,
    ),
    '',
    `Online checkout is coming soon. Until then, coaches start the free trial and email ${PLAN_CONTACT} to move to a paid plan.`,
    '',
    '## Trust',
    '',
    ...TRUST.map((t) => `- ${t.title}: ${t.body}`),
    '',
    '## FAQ',
    '',
    ...FAQ.flatMap((f) => [`### ${f.q}`, '', f.a, '']),
    '## Links',
    '',
    `- [Home](${site}/): what Repsy does, plans and FAQ`,
    `- [Start free trial](${app}/signup): create a coach account (7 days, up to 3 clients)`,
    `- [Plan and fair-billing charter](${app}/plan): cancellation, refunds and renewals`,
    `- [Changelog](${app}/changelog): what has shipped and what is next`,
    `- [Service status](${app}/status): current incidents and maintenance`,
    `- [Contact](mailto:${CONTACT_EMAIL})`,
    '',
  ];
  return lines.join('\n');
}
