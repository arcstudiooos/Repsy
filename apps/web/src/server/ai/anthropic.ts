import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import {
  AiUnavailableError,
  FakeAi,
  type AiDraftRequest,
  type AiHighlight,
  type AiPort,
} from '@kinetic/core';

/**
 * D-013 #14: the Anthropic adapter for AI drafting, through the official SDK. Requests carry only the prompt core
 * built (no workspace, user or client identifiers, no metadata). Anthropic does not train on API data. A safety
 * decline is retried server-side on Anthropic's recommended fallback model (`fallbacks: "default"`); a decline that
 * still stands, or any API error, becomes `AiUnavailableError` and the coach drafts by hand.
 */
export const AI_MODEL = 'claude-opus-5-5';

const HighlightsSchema = z.object({
  points: z
    .array(
      z.object({
        text: z.string(),
        sources: z.array(z.string()),
      }),
    )
    .max(6),
});

export class AnthropicAi implements AiPort {
  readonly name = 'anthropic' as const;
  constructor(
    private readonly client: Anthropic,
    private readonly model: string = AI_MODEL,
  ) {}

  private base(req: AiDraftRequest) {
    return {
      model: this.model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: [{ role: 'user' as const, content: req.prompt }],
      // Drafting needs care, not depth: medium keeps it quick and is this model's default made explicit.
      output_config: { effort: 'medium' as const },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default' as const,
    };
  }

  async draft(req: AiDraftRequest): Promise<string> {
    try {
      const res = await this.client.beta.messages.create(this.base(req));
      if (res.stop_reason === 'refusal') throw new AiUnavailableError('refused');
      return res.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
    } catch (e) {
      throw toUnavailable(e);
    }
  }

  async highlights(req: AiDraftRequest): Promise<AiHighlight[]> {
    try {
      const base = this.base(req);
      const res = await this.client.beta.messages.parse({
        ...base,
        output_config: { ...base.output_config, format: betaZodOutputFormat(HighlightsSchema) },
      });
      if (res.stop_reason === 'refusal') throw new AiUnavailableError('refused');
      // Core re-checks every point against the answers it was given.
      return res.parsed_output?.points ?? [];
    } catch (e) {
      throw toUnavailable(e);
    }
  }
}

function toUnavailable(e: unknown): AiUnavailableError {
  if (e instanceof AiUnavailableError) return e;
  // Typed SDK errors (rate limits, overload, bad keys) all mean "not now" to the coach; nothing is retried here
  // beyond the SDK's own retries, and no request content is logged.
  return new AiUnavailableError('error');
}

/** The configured provider: Anthropic with ANTHROPIC_API_KEY, the fake outside production with FAKE_AI=on. */
export function aiPortFromEnv(
  env: Record<string, string | undefined> = process.env,
): AiPort | null {
  const key = env.ANTHROPIC_API_KEY?.trim();
  if (key) return new AnthropicAi(new Anthropic({ apiKey: key, maxRetries: 2, timeout: 120_000 }));
  if (env.NODE_ENV !== 'production' && env.FAKE_AI?.trim() === 'on') return fakeAi();
  return null;
}

let fake: AiPort | undefined;
/** One fake per process (development and E2E). */
const fakeAi = (): AiPort => (fake ??= new FakeAi());
