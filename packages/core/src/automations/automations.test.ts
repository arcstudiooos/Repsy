import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import { setLifecycleStage } from '../clients/stage';
import { newClientWorld, newOrg, NOW, runAs } from '../sessions/fixtures.test-helpers';
import { decideStepRun, processClientEvents, runDueSteps } from './engine';
import { runHistory, saveSequence, startSequence } from './sequences';

let prisma: PrismaClient;
let drop: () => Promise<void>;
beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

const at = (iso: string) => new Date(iso);

describe('automations (PRD J1-J3, J7, J8)', () => {
  it('a trigger starts the sequence; steps run on their day at the client’s time', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org); // America/New_York
    await runAs(prisma, org.coach, (tx) =>
      saveSequence(tx, org.coach, {
        name: 'Renewal',
        trigger: 'stage_changed',
        triggerValue: 'at_renewal',
        steps: [
          {
            dayOffset: 0,
            localTime: '09:00',
            type: 'message',
            config: { body: 'Time to plan your next block!' },
          },
          { dayOffset: 2, localTime: '09:00', type: 'followup', config: { title: 'Renewal call' } },
          {
            dayOffset: 3,
            localTime: '09:00',
            type: 'message',
            askFirst: true,
            config: { body: 'Ready to renew?' },
          },
        ],
      }),
    );
    await runAs(prisma, org.coach, (tx) =>
      setLifecycleStage(tx, org.coach, w.clientId, 'at_renewal'),
    );
    expect(await processClientEvents(prisma, NOW)).toBe(1);
    expect(await processClientEvents(prisma, NOW)).toBe(0);

    // NOW is 08:00 in New York: the day-0 message is due at 09:00.
    expect(await runDueSteps(prisma, NOW)).toEqual({ done: 0, failed: 0, waiting: 0 });
    expect(await runDueSteps(prisma, at('2026-11-04T14:01:00Z'))).toEqual({
      done: 1,
      failed: 0,
      waiting: 0,
    });
    const msgs = await withSystem(
      (tx) => tx.message.findMany({ where: { body: 'Time to plan your next block!' } }),
      prisma,
    );
    expect(msgs).toHaveLength(1);
    expect(await runDueSteps(prisma, at('2026-11-06T14:01:00Z'))).toEqual({
      done: 1,
      failed: 0,
      waiting: 0,
    });
    // Ask first: waits in review, then the coach approves it.
    expect(await runDueSteps(prisma, at('2026-11-07T14:01:00Z'))).toEqual({
      done: 0,
      failed: 0,
      waiting: 1,
    });
    const history = await runAs(prisma, org.coach, (tx) => runHistory(tx, org.coach, w.clientId));
    const waiting = history[0]!.steps.find((s) => s.status === 'waiting')!;
    const flag = await withSystem(
      (tx) => tx.reviewFlag.findFirstOrThrow({ where: { ruleKey: 'automation_approval' } }),
      prisma,
    );
    expect(flag.state).toBe('open');
    expect(
      await runAs(prisma, org.coach, (tx) => decideStepRun(tx, org.coach, waiting.id, 'approve')),
    ).toBe('done');
    const after = await runAs(prisma, org.coach, (tx) => runHistory(tx, org.coach, w.clientId));
    expect(after[0]).toMatchObject({ sequenceName: 'Renewal', status: 'done' });
    expect(after[0]!.steps.map((s) => s.status)).toEqual(['done', 'done', 'done']);
  });

  it('a step that cannot run is kept as failed and raises Needs review; manual start runs once', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org);
    const seq = await runAs(prisma, org.coach, (tx) =>
      saveSequence(tx, org.coach, {
        name: 'Broken',
        trigger: 'manual',
        steps: [
          {
            dayOffset: 0,
            localTime: '00:00',
            type: 'form',
            config: { templateId: '00000000-0000-4000-8000-000000000000' },
          },
        ],
      }),
    );
    await runAs(prisma, org.coach, (tx) => startSequence(tx, org.coach, seq.id, w.clientId, NOW));
    await expect(
      runAs(prisma, org.coach, (tx) => startSequence(tx, org.coach, seq.id, w.clientId, NOW)),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await runDueSteps(prisma, NOW)).toEqual({ done: 0, failed: 1, waiting: 0 });
    const [run] = await runAs(prisma, org.coach, (tx) => runHistory(tx, org.coach, w.clientId));
    expect(run!.steps[0]).toMatchObject({ status: 'failed' });
    expect(run!.steps[0]!.error).toBeTruthy();
    expect(
      await withSystem(
        (tx) => tx.reviewFlag.count({ where: { ruleKey: 'automation_failed' } }),
        prisma,
      ),
    ).toBe(1);
  });

  it('refuses a step without what it needs', async () => {
    const org = await newOrg(prisma);
    await expect(
      runAs(prisma, org.coach, (tx) =>
        saveSequence(tx, org.coach, {
          name: 'Bad',
          trigger: 'manual',
          steps: [{ dayOffset: 0, localTime: '9am', type: 'message', config: { body: 'x' } }],
        }),
      ),
    ).rejects.toMatchObject({ fieldErrors: { 'steps.0.localTime': ['Use a time like 08:00.'] } });
  });
});
