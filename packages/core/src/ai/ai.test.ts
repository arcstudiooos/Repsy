/**
 * PRD I10, I11, I12, I14: pure-logic tests. No Postgres, no network, no provider keys. Database
 * functions are exercised only through hand-written `tx` mocks cast to `TenantTx`; the real
 * `aiSetting` / `aiDraft` models arrive with migration 20260101000086 (see SCHEMA_SNIPPET_AI.md).
 */
import type { TenantTx } from '@kinetic/db';
import { describe, expect, it } from 'vitest';
import type { ActorContext } from '../authz/actor';
import type { CheckinQuestion } from '../checkins/questions';
import { DomainError } from '../errors';
import { parseProgram } from '../programs/text-import';
import { AI_LABEL, assertProviderSafe, FakeAiProvider } from './ai';
import {
  assertNoAdviceRequest,
  createPasteDraft,
  createTemplateDraft,
  getAiSetting,
  highlightsForCoach,
  matchToLibrary,
  parseTemplateInstruction,
  redactText,
  savePasteAiDraft,
  setAiSetting,
  summarizeCheckinChanges,
} from './drafting';

const coach: ActorContext = {
  userId: 'coach-1',
  orgId: 'org-1',
  role: 'coach',
  isPlatformAdmin: false,
};
const owner: ActorContext = {
  userId: 'owner-1',
  orgId: 'org-1',
  role: 'owner',
  isPlatformAdmin: false,
};
const client: ActorContext = {
  userId: 'client-1',
  orgId: 'org-1',
  role: 'client',
  isPlatformAdmin: false,
  clientId: 'client-1',
};

const LIBRARY = [
  { id: 'ex-bench', name: 'Bench press', equipment: 'Barbell' },
  { id: 'ex-squat', name: 'Back squat', equipment: 'Barbell' },
  { id: 'ex-db-press', name: 'Dumbbell press', equipment: 'Dumbbell' },
];

const mockTx = (
  setting: { aiEnabled: boolean; provider?: string } | null,
  draftRow?: unknown,
): TenantTx =>
  ({
    aiSetting: {
      findFirst: async () =>
        setting ? { aiEnabled: setting.aiEnabled, provider: setting.provider ?? 'fake' } : null,
      upsert: async () => ({ aiEnabled: true, provider: 'fake' }),
    },
    aiDraft: {
      create: async () => draftRow,
      findMany: async () => [],
    },
  }) as unknown as TenantTx;

describe('redaction (I14)', () => {
  it('strips emails, phone numbers and supplied names from stored source text', () => {
    const out = redactText('Plan for Jane Doe, jane@example.com, call 555-123-4567', ['Jane Doe']);
    expect(out).not.toContain('jane@example.com');
    expect(out).not.toContain('555-123-4567');
    expect(out).not.toContain('Jane');
    expect(out).toContain('[redacted email]');
    expect(out).toContain('[redacted phone]');
  });
});

describe('medical / supplement guardrail (I14)', () => {
  it('refuses injury and supplement advice requests', () => {
    expect(() =>
      assertNoAdviceRequest('What supplement should I take for my knee injury?'),
    ).toThrow(DomainError);
    expect(() => assertNoAdviceRequest('Bench press 3x8 @ 60kg')).not.toThrow();
  });

  it('refuses a paste that asks for injury advice', async () => {
    await expect(
      createPasteDraft({
        provider: new FakeAiProvider(),
        sourceText: 'Day 1: Rehab for my torn meniscus, what dosage of creatine?',
        library: LIBRARY,
      }),
    ).rejects.toThrow(DomainError);
  });
});

describe('paste to program (I10)', () => {
  it('parses text locally, matches the library, and flags unmatched exercises', async () => {
    const provider = new FakeAiProvider();
    const { content } = await createPasteDraft({
      provider,
      sourceText: 'Day 1: Upper\nBench press 3x8 @ 60kg\nMystery lift 3x10',
      library: LIBRARY,
    });
    expect(content.label).toBe('Drafted with AI');
    expect(content.weeks[0]?.days[0]?.exercises[0]).toMatchObject({
      exerciseId: 'ex-bench',
      name: 'Bench press',
    });
    expect(content.unmatched).toEqual([
      { dayTitle: 'Day 1: Upper', name: 'Mystery lift', reason: 'not_in_library' },
    ]);
  });

  it('never sends raw text, notes, emails or names to the provider', async () => {
    const provider = new FakeAiProvider();
    await createPasteDraft({
      provider,
      sourceText: [
        'Exercise,Sets,Reps,Load,RPE,Notes',
        'Bench press,3,8,60,,Call jane@example.com about this secret note',
      ].join('\n'),
      library: LIBRARY,
      clientNames: ['Jane Doe'],
    });
    const sent = JSON.stringify(provider.lastRequest);
    expect(sent).not.toContain('jane@example.com');
    expect(sent).not.toContain('secret note');
    expect(sent).not.toContain('Call');
    expect(sent).toContain('Bench press');
  });

  it('marks exercises outside the requested kit as unmatched', () => {
    const parsed = parseProgram('Day 1\nBench press 3x8', 'kg');
    const { unmatched, days } = matchToLibrary(parsed, LIBRARY, ['Dumbbell']);
    expect(unmatched).toEqual([{ dayTitle: 'Day 1', name: 'Bench press', reason: 'equipment' }]);
    expect(days[0]?.exercises[0]?.exerciseId).toBeNull();
  });
});

describe('draft from template (I11)', () => {
  it('parses days, weeks, equipment and template name from one sentence', () => {
    expect(
      parseTemplateInstruction('Like my template Strength Base, 4 days, dumbbells only, 6 weeks'),
    ).toEqual({
      templateTitle: 'Strength Base',
      daysPerWeek: 4,
      weeks: 6,
      equipmentFilter: ['Dumbbell'],
    });
    const defaults = parseTemplateInstruction('Like my template Strength Base');
    expect(defaults.daysPerWeek).toBeNull();
    expect(defaults.weeks).toBe(4);
  });

  it('drops exercises outside the requested kit and reports them as unmatched', async () => {
    const provider = new FakeAiProvider();
    const content = await createTemplateDraft({
      provider,
      instruction: 'Like my template Strength Base, 2 days, dumbbells only, 1 week',
      templateDays: [
        {
          title: 'Day 1',
          exercises: [
            {
              exerciseId: 'ex-bench',
              name: 'Bench press',
              equipment: 'Barbell',
              sets: [{ reps: 8 }],
            },
            {
              exerciseId: 'ex-db-press',
              name: 'Dumbbell press',
              equipment: 'Dumbbell',
              sets: [{ reps: 10 }],
            },
          ],
        },
      ],
    });
    expect(content.weeks[0]?.days[0]?.exercises[0]?.exerciseId).toBeNull();
    expect(content.weeks[0]?.days[0]?.exercises[1]?.exerciseId).toBe('ex-db-press');
    // The single template day is cycled to fill 2 requested days, so the barbell exercise is
    // flagged once per cycled day.
    expect(content.unmatched).toEqual([
      { dayTitle: 'Day 1', name: 'Bench press', reason: 'equipment' },
      { dayTitle: 'Day 1', name: 'Bench press', reason: 'equipment' },
    ]);
  });

  it('repeats the template days across the requested weeks', async () => {
    const provider = new FakeAiProvider();
    const content = await createTemplateDraft({
      provider,
      instruction: 'Like my template Strength Base, 4 days, 6 weeks',
      templateDays: [
        {
          title: 'Day 1',
          exercises: [{ exerciseId: 'ex-bench', name: 'Bench press', sets: [{ reps: 8 }] }],
        },
        {
          title: 'Day 2',
          exercises: [{ exerciseId: 'ex-squat', name: 'Back squat', sets: [{ reps: 5 }] }],
        },
      ],
    });
    expect(content.kind).toBe('template');
    expect(content.label).toBe('Drafted with AI');
    expect(content.weeks).toHaveLength(6);
    expect(content.weeks[0]?.days).toHaveLength(4);
    // Days cycle when the template has fewer days than requested.
    expect(content.weeks[0]?.days[2]?.title).toBe('Day 1');
  });
});

describe('check-in highlights (I12)', () => {
  const questions: CheckinQuestion[] = [
    { id: 'energy', type: 'scale_1_5', label: 'Energy this week', optional: true },
    { id: 'sleep', type: 'scale_1_5', label: 'Sleep this week', optional: true },
    { id: 'notes', type: 'short_text', label: 'Anything else?', optional: true },
  ];

  it('returns only changed answers, each with a link to both source answers', () => {
    const highlights = summarizeCheckinChanges({
      clientId: 'client-9',
      questions,
      previous: { checkinId: 'prev-1', answers: { energy: 3, sleep: 4, notes: 'same' } },
      current: { checkinId: 'cur-1', answers: { energy: 4, sleep: 4, notes: 'same' } },
    });
    expect(highlights).toHaveLength(1);
    expect(highlights[0]).toMatchObject({
      questionId: 'energy',
      label: 'Energy this week',
      previous: 3,
      current: 4,
      change: 'changed',
    });
    expect(highlights[0]?.previousSourceUrl).toBe('/app/clients/client-9/check-ins#prev-1-energy');
    expect(highlights[0]?.currentSourceUrl).toBe('/app/clients/client-9/check-ins#cur-1-energy');
  });

  it('marks newly answered and newly blank questions, with a link only where an answer exists', () => {
    const highlights = summarizeCheckinChanges({
      clientId: 'client-9',
      questions,
      previous: { checkinId: 'prev-1', answers: { energy: 3 } },
      current: { checkinId: 'cur-1', answers: { notes: 'tired' } },
    });
    expect(highlights.map((h) => [h.questionId, h.change, h.previousSourceUrl === null])).toEqual([
      ['energy', 'removed', false],
      ['notes', 'added', true],
    ]);
  });

  it('is coach-only: a client actor is refused even though checkin:read admits clients', () => {
    expect(() =>
      highlightsForCoach(client, {
        clientId: 'client-9',
        questions,
        previous: { checkinId: 'p', answers: { energy: 1 } },
        current: { checkinId: 'c', answers: { energy: 2 } },
      }),
    ).toThrow(DomainError);
  });
});

describe('opt-in and draft-only guardrails (I14)', () => {
  it('is OFF by default when no setting row exists', async () => {
    await expect(getAiSetting(mockTx(null), coach)).resolves.toEqual({
      aiEnabled: false,
      provider: 'fake',
    });
  });

  it('refuses to create a draft while opt-in is off', async () => {
    await expect(
      savePasteAiDraft(mockTx(null), coach, new FakeAiProvider(), {
        sourceText: 'Day 1\nBench press 3x8',
        library: LIBRARY,
      }),
    ).rejects.toThrow(/off for this workspace/);
  });

  it('refuses draft creation for a client actor', async () => {
    await expect(
      savePasteAiDraft(mockTx({ aiEnabled: true }), client, new FakeAiProvider(), {
        sourceText: 'Day 1\nBench press 3x8',
        library: LIBRARY,
      }),
    ).rejects.toThrow(DomainError);
  });

  it('stores drafts with status draft and the AI label, never as a program', async () => {
    const content = {
      label: AI_LABEL,
      kind: 'paste',
      title: 'Pasted program',
      weeks: [],
      unmatched: [],
    };
    const row = {
      id: 'draft-1',
      kind: 'paste',
      status: 'draft',
      draftJson: content,
      createdAt: new Date(),
    };
    const view = await savePasteAiDraft(
      mockTx({ aiEnabled: true }, row),
      coach,
      new FakeAiProvider(),
      {
        sourceText: 'Day 1\nBench press 3x8',
        library: LIBRARY,
      },
    );
    expect(view.status).toBe('draft');
    expect(view.label).toBe('Drafted with AI');
    expect(view.content.label).toBe('Drafted with AI');
  });

  it('lets a manager turn the opt-in on', async () => {
    await expect(setAiSetting(mockTx(null), owner, true)).resolves.toEqual({
      aiEnabled: true,
      provider: 'fake',
    });
  });
});

describe('provider port (I14)', () => {
  it('rejects provider input carrying an email address', () => {
    expect(() =>
      assertProviderSafe({
        kind: 'paste',
        title: 'x',
        weeks: 1,
        days: [{ title: 'Day 1', exercises: [{ exerciseId: null, name: 'a@b.com', sets: [] }] }],
        equipmentFilter: [],
      }),
    ).toThrow(/email/);
  });

  it('the fake provider is deterministic and records what it received', async () => {
    const provider = new FakeAiProvider();
    const first = await provider.generateDraft({
      kind: 'paste',
      title: 'T',
      weeks: 1,
      days: [{ title: 'Day 1', exercises: [] }],
      equipmentFilter: [],
    });
    const second = await provider.generateDraft({
      kind: 'paste',
      title: 'T',
      weeks: 1,
      days: [{ title: 'Day 1', exercises: [] }],
      equipmentFilter: [],
    });
    expect(first).toEqual(second);
    expect(provider.name).toBe('fake');
  });
});
