import { describe, expect, it } from 'vitest';
import { readBodyCapped } from '@/server/routes/media';

/** A streamed (chunked) request body: no Content-Length for the route to check up front. */
function streamed(chunks: number[]): { request: Request; pulled: () => number } {
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(new Uint8Array(chunks[i++]!));
      else controller.close();
    },
  });
  const request = new Request('http://localhost/api/v1/media', {
    method: 'POST',
    body,
    duplex: 'half',
  } as RequestInit);
  return { request, pulled: () => i };
}

describe('readBodyCapped', () => {
  it('returns the whole body when it fits', async () => {
    const { request } = streamed([3, 4]);
    const body = await readBodyCapped(request, 10);
    expect(body?.length).toBe(7);
  });

  it('stops reading once the body passes the cap', async () => {
    const { request, pulled } = streamed([6, 6, 6, 6, 6]);
    expect(await readBodyCapped(request, 10)).toBeNull();
    // The rest of the stream is never pulled into memory.
    expect(pulled()).toBeLessThan(5);
  });

  it('treats a missing body as empty', async () => {
    const request = new Request('http://localhost/api/v1/media', { method: 'POST' });
    expect((await readBodyCapped(request, 10))?.length).toBe(0);
  });
});
