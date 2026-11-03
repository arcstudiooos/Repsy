/**
 * PRD I14 (D-013 #14): the AI provider behind a port. Core builds every prompt and checks every answer; an adapter
 * only carries text there and back. The Anthropic adapter lives in the web app (it uses the official SDK); the fake
 * is deterministic for development and tests. Requests carry no workspace, user or client identifiers.
 */
export interface AiDraftRequest {
  system: string;
  prompt: string;
  maxTokens: number;
}

export interface AiHighlight {
  text: string;
  /** Ids of the answers the point is based on (as given in the prompt). */
  sources: string[];
}

export interface AiPort {
  readonly name: 'anthropic' | 'fake';
  /** Plain text out (I10, I11). */
  draft(req: AiDraftRequest): Promise<string>;
  /** Structured points out (I12). */
  highlights(req: AiDraftRequest): Promise<AiHighlight[]>;
}

/** The provider declined or failed; the coach sees a plain message, nothing is drafted. */
export class AiUnavailableError extends Error {
  constructor(
    readonly reason: 'refused' | 'error',
    message = reason === 'refused'
      ? 'The drafting assistant declined this request. Write it yourself or rephrase.'
      : 'The drafting assistant is unavailable right now. Try again later.',
  ) {
    super(message);
    this.name = 'AiUnavailableError';
  }
}

/** Text between the INPUT markers of a prompt (what the fake echoes back). */
const inputOf = (prompt: string) => /<input>\n([\s\S]*?)\n<\/input>/.exec(prompt)?.[1] ?? '';

/**
 * Deterministic stand-in. `draft` returns the prompt's input section, tidied the way a model would (bullets and
 * numbering stripped), plus any `extraLines` (tests use them to check the safety filter). `highlights` returns one
 * point per current answer it can see.
 */
export class FakeAi implements AiPort {
  readonly name = 'fake' as const;
  readonly calls: AiDraftRequest[] = [];
  extraLines: string[] = [];
  refuse = false;

  draft(req: AiDraftRequest): Promise<string> {
    this.calls.push(req);
    if (this.refuse) return Promise.reject(new AiUnavailableError('refused'));
    const lines = inputOf(req.prompt)
      .split('\n')
      .map((l) => l.replace(/^\s*(?:[-•*]|\d+[.)])\s+/, '').trimEnd());
    return Promise.resolve([...lines, ...this.extraLines].join('\n'));
  }

  highlights(req: AiDraftRequest): Promise<AiHighlight[]> {
    this.calls.push(req);
    if (this.refuse) return Promise.reject(new AiUnavailableError('refused'));
    const out: AiHighlight[] = [];
    for (const m of req.prompt.matchAll(/^\[(c:[^\]]+)\] (.+)$/gm)) {
      out.push({ text: `Now: ${m[2]!.slice(0, 80)}`, sources: [m[1]!] });
    }
    for (const l of this.extraLines) out.push({ text: l, sources: out[0]?.sources ?? [] });
    return Promise.resolve(out);
  }
}
