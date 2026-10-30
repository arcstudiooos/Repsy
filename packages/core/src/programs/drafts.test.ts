import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, withTenant, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import type { ActorContext } from '../authz/actor';
import { DomainError } from '../errors';
import { commitProgramVersion, type WeekInput } from './commit';
import { discardDraft, getDraft, saveDraft } from './drafts';
import { createProgram } from './read';

let prisma: PrismaClient;
let drop: () => Promise<void>;
let coachId: string;

const BENCH = 'e0000000-0000-4000-8000-000000000001';

const newActor = async (): Promise<ActorContext> => {
  const org = await withSystem(
    (tx) => tx.organization.create({ data: { name: 'O', timezone: 'UTC', ownerUserId: coachId } }),
    prisma,
  );
  return { userId: coachId, orgId: org.id, role: 'owner', isPlatformAdmin: false };
};
const run = <T>(actor: ActorContext, fn: Parameters<typeof withTenant<T>>[1]) =>
  withTenant(actor.orgId, fn, prisma, { userId: actor.userId });
const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: unknown) => (e instanceof DomainError ? e.code : `other:${String(e)}`),
  );
const weeks = (title = 'A'): WeekInput[] => [
  { days: [{ title, exercises: [{ exerciseId: BENCH, sets: [{ reps: 8, loadKg: 60 }] }] }] },
];
const mk = async (actor: ActorContext) =>
  (await run(actor, (tx) => createProgram(tx, actor, { title: 'P' }))).id;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
  coachId = (
    await withSystem(
      (tx) => tx.user.create({ data: { email: 'c@example.test', name: 'Coach C' } }),
      prisma,
    )
  ).id;
});
afterAll(async () => {
  await drop();
});

describe('program drafts', () => {
  it('save then get round-trips raw editor state (invalid weeks allowed)', async () => {
    const actor = await newActor();
    const id = await mk(actor);
    const raw = [{ days: [{ title: '', exercises: [] }] }, 'junk'];
    const saved = await run(actor, (tx) =>
      saveDraft(tx, actor, id, { baseVersionNo: null, title: 'Draft T', weeks: raw }),
    );
    const got = await run(actor, (tx) => getDraft(tx, actor, id));
    expect(got).toMatchObject({
      baseVersionNo: null,
      title: 'Draft T',
      weeks: raw,
      updatedAt: saved.updatedAt,
      updatedBy: { id: coachId, name: 'Coach C' },
    });
  });

  it('get with no draft returns null; discard is idempotent', async () => {
    const actor = await newActor();
    const id = await mk(actor);
    expect(await run(actor, (tx) => getDraft(tx, actor, id))).toBeNull();
    await run(actor, (tx) => discardDraft(tx, actor, id));
    await run(actor, (tx) => saveDraft(tx, actor, id, { baseVersionNo: null, weeks: [] }));
    await run(actor, (tx) => discardDraft(tx, actor, id));
    await run(actor, (tx) => discardDraft(tx, actor, id));
    expect(await run(actor, (tx) => getDraft(tx, actor, id))).toBeNull();
  });

  it('second save overwrites (one row)', async () => {
    const actor = await newActor();
    const id = await mk(actor);
    await run(actor, (tx) => saveDraft(tx, actor, id, { baseVersionNo: null, weeks: [] }));
    await run(actor, (tx) =>
      saveDraft(tx, actor, id, { baseVersionNo: 2, title: 'Two', weeks: [{}] }),
    );
    expect(await run(actor, (tx) => tx.programDraft.count({ where: { programId: id } }))).toBe(1);
    expect(await run(actor, (tx) => getDraft(tx, actor, id))).toMatchObject({
      baseVersionNo: 2,
      title: 'Two',
      weeks: [{}],
    });
  });

  it('commit deletes the draft', async () => {
    const actor = await newActor();
    const id = await mk(actor);
    await run(actor, (tx) => saveDraft(tx, actor, id, { baseVersionNo: null, weeks: [] }));
    await run(actor, (tx) =>
      commitProgramVersion(tx, actor, { programId: id, expectedVersionNo: null, weeks: weeks() }),
    );
    expect(await run(actor, (tx) => getDraft(tx, actor, id))).toBeNull();
  });

  it('409 commit keeps the draft', async () => {
    const actor = await newActor();
    const id = await mk(actor);
    await run(actor, (tx) =>
      commitProgramVersion(tx, actor, { programId: id, expectedVersionNo: null, weeks: weeks() }),
    );
    await run(actor, (tx) => saveDraft(tx, actor, id, { baseVersionNo: null, weeks: [] }));
    expect(
      await codeOf(
        run(actor, (tx) =>
          commitProgramVersion(tx, actor, {
            programId: id,
            expectedVersionNo: null,
            weeks: weeks('B'),
          }),
        ),
      ),
    ).toBe('CONFLICT');
    expect(await run(actor, (tx) => getDraft(tx, actor, id))).not.toBeNull();
  });

  it('oversize draft -> VALIDATION weeks; non-array and too many weeks too', async () => {
    const actor = await newActor();
    const id = await mk(actor);
    const big = [{ pad: 'x'.repeat(300_000) }];
    const err = await run(actor, (tx) =>
      saveDraft(tx, actor, id, { baseVersionNo: null, weeks: big }),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe('VALIDATION');
    expect((err as DomainError).fieldErrors).toEqual({
      weeks: ['This draft is too large to save.'],
    });
    expect(
      await codeOf(
        run(actor, (tx) => saveDraft(tx, actor, id, { baseVersionNo: null, weeks: 'x' })),
      ),
    ).toBe('VALIDATION');
    expect(
      await codeOf(
        run(actor, (tx) =>
          saveDraft(tx, actor, id, { baseVersionNo: null, weeks: Array(17).fill({}) }),
        ),
      ),
    ).toBe('VALIDATION');
  });

  it("other org's program -> NOT_FOUND (all three), bad id too", async () => {
    const a = await newActor();
    const b = await newActor();
    const id = await mk(a);
    await run(a, (tx) => saveDraft(tx, a, id, { baseVersionNo: null, weeks: [] }));
    expect(await codeOf(run(b, (tx) => getDraft(tx, b, id)))).toBe('NOT_FOUND');
    expect(await codeOf(run(b, (tx) => discardDraft(tx, b, id)))).toBe('NOT_FOUND');
    expect(
      await codeOf(run(b, (tx) => saveDraft(tx, b, id, { baseVersionNo: null, weeks: [] }))),
    ).toBe('NOT_FOUND');
    expect(await codeOf(run(a, (tx) => getDraft(tx, a, 'nope')))).toBe('NOT_FOUND');
  });

  it('client copy of an ended assignment -> CONFLICT; of the active one -> ok', async () => {
    const actor = await newActor();
    const client = await withSystem(
      (tx) =>
        tx.client.create({
          data: {
            organizationId: actor.orgId,
            coachUserId: coachId,
            name: 'Cli',
            email: `c-${actor.orgId}@example.test`,
            status: 'active',
            timezone: 'UTC',
          },
        }),
      prisma,
    );
    const mkCopy = async (status: 'active' | 'ended') =>
      withSystem(async (tx) => {
        const p = await tx.program.create({
          data: {
            organizationId: actor.orgId,
            title: 'Copy',
            kind: 'client',
            clientId: client.id,
            createdBy: coachId,
          },
        });
        await tx.programAssignment.create({
          data: {
            organizationId: actor.orgId,
            clientId: client.id,
            programId: p.id,
            startLocalDate: new Date('2026-11-04'),
            weekdays: [1],
            timezone: 'UTC',
            status,
          },
        });
        return p.id;
      }, prisma);
    const ended = await mkCopy('ended');
    const active = await mkCopy('active');
    const save = (id: string) =>
      run(actor, (tx) => saveDraft(tx, actor, id, { baseVersionNo: null, weeks: [] }));
    expect(await codeOf(save(ended))).toBe('CONFLICT');
    expect(await codeOf(run(actor, (tx) => getDraft(tx, actor, ended)))).toBe('CONFLICT');
    expect(await codeOf(run(actor, (tx) => discardDraft(tx, actor, ended)))).toBe('CONFLICT');
    expect(await codeOf(save(active))).toBe('ok');
  });
});
