/**
 * PRD I14: the AI provider port. Core never imports a provider SDK and never makes a network call to an
 * AI provider. A provider receives ONLY structured, redacted input (see `drafting.ts`): exercise names
 * from the coach's own library, set prescriptions, and equipment filters. It never receives client names,
 * emails, free-text client content, or pasted source text. The only implementation shipped here is the
 * fake/local one; a real provider is a future adapter behind this same interface, and it must never be
 * given customer data to train on.
 */

/** Every AI-produced draft is labelled with this, in the UI and in the stored draft. */
export const AI_LABEL = 'Drafted with AI';

/** One prescribed set, as passed to and returned by the provider. No free text. */
export interface AiDraftSet {
  reps?: number;
  repsMax?: number;
  loadKg?: number;
  rpe?: number;
  durationSec?: number;
  distanceM?: number;
}

/** One exercise in a provider request or response. `exerciseId` is null when unmatched. */
export interface AiDraftExercise {
  exerciseId: string | null;
  /** The library name (matched) or the name as pasted (unmatched, for the coach to fix). */
  name: string;
  sets: AiDraftSet[];
}

export interface AiDraftDay {
  title: string;
  exercises: AiDraftExercise[];
}

export interface AiDraftWeek {
  days: AiDraftDay[];
}

export type AiDraftKind = 'paste' | 'template';

/**
 * The ONLY shape a provider ever sees. Structured only: no source text, no notes, no client identifiers,
 * no check-in answers. `templateTitle` is the coach's own template name, never a client name.
 */
export interface AiDraftRequest {
  kind: AiDraftKind;
  title: string;
  /** Requested week count (template drafts) or the parsed week count (paste drafts). */
  weeks: number;
  days: AiDraftDay[];
  /** Equipment names from the coach's library filter, e.g. ["Dumbbell"]. Empty means no filter. */
  equipmentFilter: string[];
  templateTitle?: string;
}

export interface AiDraftResponse {
  title: string;
  weeks: AiDraftWeek[];
}

export interface AiProvider {
  readonly name: string;
  generateDraft(request: AiDraftRequest): Promise<AiDraftResponse>;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

/** Throws when a provider request carries anything that looks like personal data. */
export function assertProviderSafe(request: AiDraftRequest): void {
  const scan = (value: unknown): void => {
    if (typeof value === 'string') {
      if (EMAIL.test(value))
        throw new Error('AI provider input must not contain an email address.');
    } else if (Array.isArray(value)) {
      value.forEach(scan);
    } else if (value !== null && typeof value === 'object') {
      Object.values(value as Record<string, unknown>).forEach(scan);
    }
  };
  scan(request);
  if (request.title.length > 120) throw new Error('AI draft title is too long.');
  if (!Number.isInteger(request.weeks) || request.weeks < 1 || request.weeks > 104) {
    throw new Error('AI draft week count must be 1-104.');
  }
}

/**
 * Fake/local provider: no network, no keys, no model. Paste drafts pass the structured days through
 * unchanged. Template drafts repeat the template's first-week days across the requested weeks, cycling
 * days when the coach asked for more days than the template has, and trimming when they asked for fewer.
 * Deterministic, so tests and the coach see the same draft for the same input.
 */
export class FakeAiProvider implements AiProvider {
  readonly name = 'fake';
  /** The last request received, for tests and auditing. Never persisted with client data. */
  lastRequest: AiDraftRequest | null = null;

  async generateDraft(request: AiDraftRequest): Promise<AiDraftResponse> {
    assertProviderSafe(request);
    this.lastRequest = request;
    if (request.kind === 'paste') {
      return { title: request.title, weeks: [{ days: request.days }] };
    }
    const daysPerWeek = request.days.length;
    if (daysPerWeek === 0) return { title: request.title, weeks: [] };
    const weeks: AiDraftWeek[] = [];
    for (let w = 0; w < request.weeks; w++) {
      weeks.push({ days: request.days.map((d) => ({ ...d })) });
    }
    return { title: request.title, weeks };
  }
}
