import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { AiUnavailableError } from '@kinetic/core';
import { AI_MODEL, AnthropicAi, aiPortFromEnv } from '@/server/ai/anthropic';

/** Records each request and answers with the next canned Messages API response. */
function stub(responses: unknown[]) {
  const seen: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({
      url: String(url),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    });
    return new Response(JSON.stringify(responses.shift()), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const client = new Anthropic({
    apiKey: 'test-key',
    fetch: fetchImpl as typeof fetch,
    maxRetries: 0,
  });
  return { ai: new AnthropicAi(client), seen };
}

const message = (content: unknown[], stop_reason = 'end_turn') => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: AI_MODEL,
  content,
  stop_reason,
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 10 },
});

describe('Anthropic adapter (D-013 #14)', () => {
  it('sends only the prompt, on the default model with server-side fallback, and returns the text', async () => {
    const { ai, seen } = stub([message([{ type: 'text', text: 'Day 1: Push\nBench press 3x8' }])]);
    const out = await ai.draft({ system: 'sys', prompt: 'hello', maxTokens: 1000 });
    expect(out).toBe('Day 1: Push\nBench press 3x8');
    const req = seen[0]!;
    expect(req.url).toMatch(/\/v1\/messages/);
    expect(req.headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    expect(req.body).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 1000,
      system: 'sys',
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      messages: [{ role: 'user', content: 'hello' }],
    });
    // No identifiers travel with the request.
    expect(req.body.metadata).toBeUndefined();
  });

  it('turns a standing refusal or an API error into AiUnavailableError', async () => {
    const refused = stub([message([], 'refusal')]);
    await expect(
      refused.ai.draft({ system: 's', prompt: 'p', maxTokens: 10 }),
    ).rejects.toMatchObject({
      reason: 'refused',
    });
    const client = new Anthropic({
      apiKey: 'k',
      maxRetries: 0,
      fetch: (async () => new Response('{"type":"error"}', { status: 500 })) as typeof fetch,
    });
    await expect(
      new AnthropicAi(client).draft({ system: 's', prompt: 'p', maxTokens: 10 }),
    ).rejects.toBeInstanceOf(AiUnavailableError);
  });

  it('asks for structured highlights and returns the parsed points', async () => {
    const points = { points: [{ text: 'Energy is up', sources: ['c:q1', 'p:q1'] }] };
    const { ai, seen } = stub([message([{ type: 'text', text: JSON.stringify(points) }])]);
    expect(await ai.highlights({ system: 's', prompt: 'p', maxTokens: 500 })).toEqual(
      points.points,
    );
    expect(seen[0]!.body.output_config).toMatchObject({ format: { type: 'json_schema' } });
  });

  it('is off without a key, and the fake only outside production when asked for', () => {
    expect(aiPortFromEnv({})).toBeNull();
    expect(aiPortFromEnv({ FAKE_AI: 'on', NODE_ENV: 'production' })).toBeNull();
    expect(aiPortFromEnv({ FAKE_AI: 'on' })?.name).toBe('fake');
    expect(aiPortFromEnv({ ANTHROPIC_API_KEY: 'k' })?.name).toBe('anthropic');
  });
});
