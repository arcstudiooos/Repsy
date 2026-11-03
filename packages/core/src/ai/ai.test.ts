import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import type { ActorContext } from '../authz/actor';
import { DomainError } from '../errors';
import { newClientWorld, newOrg, runAs } from '../sessions/fixtures.test-helpers';
import {
  AI_DAILY_CAP,
  completeHighlights,
  completeProgramDraft,
  draftProgramFromText,
  highlightsRequest,
  templateDraftRequest,
  finishAiRequest,
  setAiEnabled,
  startAiRequest,
} from './drafting';
import { filterUnsafe, redactContact } from './guardrails';
import { FakeAi } from './port';

let prisma: PrismaClient;
let drop: () => Promise<void>;
beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: unknown) => (e instanceof DomainError ? e.code : `other:${String(e)}`),
  );

describe('guardrails (I14)', () => {
  it('removes contact details but keeps training numbers', () => {
    const r = redactContact(
      'Ping jo@example.test or +44 7700 900123, see https://x.test/p\nBench 3x8 @ 60kg RPE 8\nRun 1x5km',
    );
    expect(r.text).not.toMatch(/jo@|7700|https:/);
    expect(r.text).toContain('Bench 3x8 @ 60kg RPE 8');
    expect(r.text).toContain('Run 1x5km');
    expect(r.redactions).toBe(3);
  });

  it('removes injury, medical and supplement lines one by one', () => {
    const r = filterUnsafe(
      'Day 1: Upper\nBench press 3x8\nSkip if your shoulder hurts or is painful\nTake creatine daily\nRow 3x10',
    );
    expect(r.text).toBe('Day 1: Upper\nBench press 3x8\nRow 3x10');
    expect(r.removed).toBe(2);
    // Common ways of saying it are caught too (review S5)…
    for (const line of [
      'Knee hurting more than last week',
      'Felt dizzy on Tuesday',
      'Back is sore',
    ]) {
      expect(filterUnsafe(line).removed).toBe(1);
    }
    // …while ordinary exercises pass.
    const program =
      'Shoulder press 3x8\nKnee raise 3x12\nHill sprint 6x30s\nDrill work 1x10min\nPallof press 3x10';
    expect(filterUnsafe(program).removed).toBe(0);
  });
});

describe('opt-in, roles and the daily cap (I14)', () => {
  it('is off by default; only the owner turns it on; only trainers use it; 50 a day', async () => {
    const org = await newOrg(prisma);
    expect(
      await code(
        runAs(prisma, org.coach, (tx) => startAiRequest(tx, org.coach, 'program_from_text', 10)),
      ),
    ).toBe('FORBIDDEN');
    const admin: ActorContext = { ...org.coach, role: 'admin' };
    expect(await code(runAs(prisma, admin, (tx) => setAiEnabled(tx, admin, true)))).toBe(
      'FORBIDDEN',
    );
    await runAs(prisma, org.coach, (tx) => setAiEnabled(tx, org.coach, true));
    const assistant: ActorContext = { ...org.coach, role: 'assistant' };
    expect(
      await code(
        runAs(prisma, assistant, (tx) => startAiRequest(tx, assistant, 'program_from_text', 10)),
      ),
    ).toBe('FORBIDDEN');

    const { requestId } = await runAs(prisma, org.coach, (tx) =>
      startAiRequest(tx, org.coach, 'program_from_text', 10),
    );
    await runAs(prisma, org.coach, (tx) =>
      finishAiRequest(tx, org.coach, requestId, {
        status: 'ok',
        kind: 'program_from_text',
        outputChars: 5,
      }),
    );
    await withSystem(
      (tx) =>
        tx.aiRequest.createMany({
          data: Array.from({ length: AI_DAILY_CAP - 1 }, () => ({
            organizationId: org.orgId,
            kind: 'program_from_text',
          })),
        }),
      prisma,
    );
    expect(
      await code(
        runAs(prisma, org.coach, (tx) => startAiRequest(tx, org.coach, 'program_from_text', 10)),
      ),
    ).toBe('RATE_LIMITED');
    // The log holds sizes and outcomes only.
    const row = await withSystem(
      (tx) => tx.aiRequest.findUniqueOrThrow({ where: { id: requestId } }),
      prisma,
    );
    expect(row).toMatchObject({ status: 'ok', inputChars: 10, outputChars: 5 });
  });
});

describe('drafts (I10, I11, I12)', () => {
  it('I10: pasted text becomes an import draft; contact details never reach the provider; unsafe lines are removed', async () => {
    const ai = new FakeAi();
    ai.extraLines = ['Take ibuprofen if your knee aches'];
    const d = await draftProgramFromText(ai, {
      text: 'For Priya Sharma, sam@example.test\nDay 1: Push\n- Bench press 3x8 @ 60kg\n- Push-up 3x12',
      units: 'kg',
      library: ['Bench press', 'Push-up'],
      clientNames: ['Priya Sharma'],
    });
    expect(ai.calls[0]?.prompt).not.toContain('Priya');
    expect(ai.calls[0]?.prompt).not.toContain('sam@example.test');
    expect(d.text).not.toMatch(/ibuprofen/);
    expect(d.removedLines).toBe(1);
    expect(d.note).toMatch(/1 line was removed/);
    // The stray first line lands in its own day; the program's exercises follow.
    expect(d.parsed.weeks[0]?.days.flatMap((day) => day.lines.map((l) => l.name))).toEqual(
      expect.arrayContaining(['Bench press', 'Push-up']),
    );
  });

  it('I11: the template’s structure and library names go out, never client details; a refusal is reported', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const ai = new FakeAi();
    const input = {
      templateId: w.templateId,
      request: '4 days, dumbbells only, 6 weeks',
      units: 'kg' as const,
      library: ['Goblet squat'],
    };
    const { req } = await runAs(prisma, w.coach, (tx) => templateDraftRequest(tx, w.coach, input));
    // The provider is called with no transaction open.
    const d = await completeProgramDraft(ai, req, 'kg');
    const prompt = ai.calls[0]!.prompt;
    expect(prompt).toContain("The coach's template:");
    expect(prompt).toContain('Goblet squat');
    expect(prompt).not.toMatch(/@example\.test/);
    expect(d.text).toContain('4 days, dumbbells only, 6 weeks');

    ai.refuse = true;
    await expect(completeProgramDraft(ai, req, 'kg')).rejects.toMatchObject({
      name: 'AiUnavailableError',
      reason: 'refused',
    });
    // Another workspace's template is not found.
    const other = await newOrg(prisma);
    expect(
      await code(runAs(prisma, other.coach, (tx) => templateDraftRequest(tx, other.coach, input))),
    ).toBe('NOT_FOUND');
  });

  it('I12: highlights cite real answers only, unsafe points are dropped, and nothing names the client', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const questions = [
      { id: 'q1', type: 'scale_1_5', label: 'Energy this week', optional: true },
      { id: 'q2', type: 'long_text', label: 'Anything else?', optional: true },
    ];
    const ids = await withSystem(async (tx) => {
      const t = await tx.checkinTemplate.create({
        data: { organizationId: w.orgId, title: 'Weekly', questionsJson: questions },
      });
      const make = (day: string, answers: Record<string, string | number>) =>
        tx.checkin.create({
          data: {
            organizationId: w.orgId,
            clientId: w.clientId,
            templateId: t.id,
            periodLocalDate: new Date(`${day}T00:00:00Z`),
            questionsJson: questions,
            issuedAt: new Date(`${day}T08:00:00Z`),
            dueAt: new Date(`${day}T20:00:00Z`),
            submittedAt: new Date(`${day}T12:00:00Z`),
            answersJson: answers,
            submitIdempotencyKey: `test-${day}`,
          },
        });
      const prev = await make('2026-10-28', { q1: 3, q2: 'Busy week' });
      const client = await tx.client.findUniqueOrThrow({ where: { id: w.clientId } });
      const first = client.name.split(' ')[0]!;
      const cur = await make('2026-11-04', {
        q1: 5,
        q2: `Slept well. ${first} here, email me at c@example.test`,
      });
      return { prev: prev.id, cur: cur.id };
    }, prisma);

    const ai = new FakeAi();
    ai.extraLines = ['Consider a magnesium supplement'];
    const prepared = await runAs(prisma, w.coach, (tx) => highlightsRequest(tx, w.coach, ids.cur));
    const r = await completeHighlights(ai, prepared);
    const prompt = ai.calls[0]!.prompt;
    expect(prompt).toContain('[p:q1] 3');
    expect(prompt).toContain('[c:q1] 5');
    expect(prompt).not.toContain('c@example.test');
    const name = await withSystem(
      (tx) => tx.client.findUniqueOrThrow({ where: { id: w.clientId }, select: { name: true } }),
      prisma,
    );
    expect(prompt).not.toContain(name.name);
    // The client's own name, written in an answer, is replaced too (review S4).
    for (const part of name.name.split(' ').filter((p) => p.length >= 3)) {
      expect(prompt).not.toMatch(new RegExp(`\\b${part}\\b`));
    }
    expect(prompt).toContain('[name] here');
    expect(r.previousId).toBe(ids.prev);
    expect(r.points.length).toBe(2);
    expect(r.points.every((p) => p.sources.length > 0)).toBe(true);
    expect(r.points[0]?.sources[0]).toMatchObject({ questionId: 'q1', checkin: 'current' });
    expect(r.removed).toBe(1);
  });
});
