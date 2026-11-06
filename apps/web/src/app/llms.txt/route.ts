import { llmsTxt } from '@/lib/llmsTxt';

/** /llms.txt for AI answer engines and agents (SEO/AEO audit 2026-11-06); the content is in lib/llmsTxt.ts. */
export function GET(): Response {
  return new Response(llmsTxt(), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
