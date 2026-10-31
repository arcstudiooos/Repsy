import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { DomainError } from '../errors';
import { createNote } from '../history/notes';
import { getMyThread, sendMessage } from '../messages/messages';
import {
  newClientWorld,
  newOrg,
  NOW,
  runAs,
  sessionsOf,
  type ClientWorld,
} from '../sessions/fixtures.test-helpers';
import { toCsv } from './csv';
import {
  claimExport,
  completeExport,
  exportFileFor,
  failExport,
  listMyExports,
  requestExport,
  type ExportStorage,
  type ExportTxRunner,
} from './exports';

let prisma: PrismaClient;
let drop: () => Promise<void>;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: unknown) => (e instanceof DomainError ? e.code : String(e)),
  );

/** In-memory storage that can be told to fail on the nth put. */
function memoryStorage(failOnPut?: number) {
  const objects = new Map<string, string>();
  let puts = 0;
  const storage: ExportStorage = {
    async put(key, body) {
      puts += 1;
      if (failOnPut !== undefined && puts === failOnPut) throw new Error('disk full');
      objects.set(key, body);
    },
    async deleteMany(keys) {
      for (const k of keys) objects.delete(k);
    },
  };
  return { storage, objects };
}

/** The worker's tenant-transaction runner, as the coach (`completeExport` opens its own transactions). */
const runner =
  (w: ClientWorld): ExportTxRunner =>
  (fn) =>
    runAs(prisma, w.coach, fn);

/** Requests, claims and builds an export for `actor` in `w`'s org; returns the CSVs by file name. */
async function exportFor(w: ClientWorld, as: 'coach' | 'client', storage = memoryStorage()) {
  const actor = as === 'coach' ? w.coach : w.client;
  const view = await runAs(prisma, actor, (tx) =>
    requestExport(tx, actor, {
      scope: as === 'coach' ? 'org' : 'client_self',
      idempotencyKey: crypto.randomUUID(),
    }),
  );
  const job = await runAs(prisma, w.coach, (tx) => claimExport(tx, view.id, NOW));
  expect(await completeExport(runner(w), w.orgId, job!, storage.storage, NOW)).toBe(true);
  const csv = Object.fromEntries(
    [...storage.objects.entries()].map(([k, v]) => [k.split('/').pop() as string, v]),
  );
  return { id: view.id, csv };
}

describe('exports (S5-2)', () => {
  it('the organization export covers its clients only', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const other = await newClientWorld(prisma, await newOrg(prisma));
    const { csv } = await exportFor(w, 'coach');
    expect(Object.keys(csv).sort()).toEqual([
      'checkins.csv',
      'clients.csv',
      'sessions.csv',
      'set_logs.csv',
    ]);
    const clientEmail = (
      await withSystem((tx) => tx.client.findUniqueOrThrow({ where: { id: w.clientId } }), prisma)
    ).email;
    const otherEmail = (
      await withSystem(
        (tx) => tx.client.findUniqueOrThrow({ where: { id: other.clientId } }),
        prisma,
      )
    ).email;
    expect(csv['clients.csv']).toContain(clientEmail);
    expect(Object.values(csv).join('')).not.toContain(otherEmail);
    expect(Object.values(csv).join('')).not.toContain(other.clientId);
    expect(csv['sessions.csv']?.split('\r\n').filter(Boolean)).toHaveLength(4); // header + 3 sessions
  });

  it("a client's export holds their own rows and messages, never notes or a sibling's data", async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const sibling = await newClientWorld(prisma, { orgId: w.orgId, coach: w.coach });
    const thread = await runAs(prisma, w.client, (tx) => getMyThread(tx, w.client));
    await runAs(prisma, w.client, (tx) =>
      sendMessage(tx, w.client, thread.id, { body: 'Hi coach' }),
    );
    await runAs(prisma, w.coach, (tx) =>
      createNote(tx, w.coach, w.clientId, { body: 'Private coach note' }),
    );
    const { csv } = await exportFor(w, 'client');
    expect(Object.keys(csv).sort()).toEqual([
      'checkins.csv',
      'messages.csv',
      'profile.csv',
      'sessions.csv',
      'set_logs.csv',
    ]);
    const all = Object.values(csv).join('');
    expect(csv['messages.csv']).toContain('Hi coach');
    expect(csv['messages.csv']).toContain(',you,');
    expect(all).not.toContain('Private coach note');
    expect(all).not.toContain(sibling.clientId);
    for (const s of await sessionsOf(prisma, sibling.assignmentId)) expect(all).not.toContain(s.id);
  });

  it('requests are idempotent per key; roles are enforced', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const key = crypto.randomUUID();
    const a = await runAs(prisma, w.coach, (tx) =>
      requestExport(tx, w.coach, { scope: 'org', idempotencyKey: key }),
    );
    const b = await runAs(prisma, w.coach, (tx) =>
      requestExport(tx, w.coach, { scope: 'org', idempotencyKey: key }),
    );
    expect(b.id).toBe(a.id);
    expect(a).toMatchObject({ status: 'queued', files: [] });
    expect(
      await codeOf(
        runAs(prisma, w.client, (tx) =>
          requestExport(tx, w.client, { scope: 'org', idempotencyKey: crypto.randomUUID() }),
        ),
      ),
    ).toBe('FORBIDDEN');
    expect(
      await codeOf(
        runAs(prisma, w.coach, (tx) =>
          requestExport(tx, w.coach, { scope: 'client_self', idempotencyKey: crypto.randomUUID() }),
        ),
      ),
    ).toBe('FORBIDDEN');
    expect(await runAs(prisma, w.client, (tx) => listMyExports(tx, w.client))).toEqual([]);
  });

  it('downloads: only the requester, only until it expires', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const { id } = await exportFor(w, 'client');
    const mine = await runAs(prisma, w.client, (tx) =>
      exportFileFor(tx, w.client, id, 'sessions.csv', { now: NOW }),
    );
    expect(mine.key).toBe(`exports/${w.orgId}/${id}/sessions.csv`);
    expect(
      await codeOf(
        runAs(prisma, w.coach, (tx) =>
          exportFileFor(tx, w.coach, id, 'sessions.csv', { now: NOW }),
        ),
      ),
    ).toBe('FORBIDDEN');
    const later = new Date(NOW.getTime() + 8 * 86_400_000);
    expect(
      await codeOf(
        runAs(prisma, w.client, (tx) =>
          exportFileFor(tx, w.client, id, 'sessions.csv', { now: later }),
        ),
      ),
    ).toBe('FORBIDDEN');
    expect(
      await codeOf(
        runAs(prisma, w.client, (tx) => exportFileFor(tx, w.client, id, 'nope.csv', { now: NOW })),
      ),
    ).toBe('NOT_FOUND');
    const outsider = await newOrg(prisma);
    expect(
      await codeOf(
        runAs(prisma, outsider.coach, (tx) =>
          exportFileFor(tx, outsider.coach, id, 'sessions.csv'),
        ),
      ),
    ).toBe('NOT_FOUND');
  });

  it('partial failure: written objects are removed, retried, then failed; no file is offered', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const view = await runAs(prisma, w.coach, (tx) =>
      requestExport(tx, w.coach, { scope: 'org', idempotencyKey: crypto.randomUUID() }),
    );
    for (let attempt = 1; attempt <= 3; attempt++) {
      const mem = memoryStorage(3);
      const job = await runAs(prisma, w.coach, (tx) => claimExport(tx, view.id, NOW));
      await expect(completeExport(runner(w), w.orgId, job!, mem.storage, NOW)).rejects.toThrow(
        'disk full',
      );
      expect(mem.objects.size).toBe(0);
      const outcome = await runAs(prisma, w.coach, (tx) => failExport(tx, job!));
      expect(outcome).toBe(attempt < 3 ? 'retry' : 'failed');
    }
    const [mine] = await runAs(prisma, w.coach, (tx) => listMyExports(tx, w.coach));
    expect(mine).toMatchObject({ status: 'failed', files: [] });
    expect(await runAs(prisma, w.coach, (tx) => claimExport(tx, view.id, NOW))).toBeNull();
  });
});

describe('toCsv', () => {
  it('escapes quotes, commas and newlines; neutralises formulas', () => {
    expect(
      toCsv(
        ['a', 'b'],
        [
          ['x,y', 'say "hi"'],
          ['=SUM(A1)', 3],
          [null, true],
          ['line\nbreak', -2],
        ],
      ),
    ).toBe('a,b\r\n"x,y","say ""hi"""\r\n\'=SUM(A1),3\r\n,true\r\n"line\nbreak",-2\r\n');
  });
});
