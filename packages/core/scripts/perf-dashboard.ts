/**
 * `pnpm perf:dashboard` (S5-5, §12): the coach dashboard's data load for an organization with 50 active clients,
 * measured in-process against a throwaway database. Reports p50/p75/p95 over 40 runs and fails when p75 is over
 * 2.5 s. It measures the queries the `/app` page runs (rendering adds little server time); run it with DATABASE_URL
 * pointing at a Postgres 16 like the tests.
 */
import { withSystem, withTenant } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import {
  countOpenFlags,
  countRecentMissed,
  evaluateRules,
  getAdherenceSeries,
  getAnalytics,
  getClientAdherence,
  getDailySessionStates,
  getPersonalRecords,
  isoWeekOf,
  listCheckinsAwaitingReview,
  getReviewCounts,
  listFlags,
  unreadMessageCount,
} from '../src/index';
import { grid, newClientWorld, newOrg, NOW } from '../src/sessions/fixtures.test-helpers';

const CLIENTS = 50;
const RUNS = 40;
const BUDGET_MS = 2500;

const pct = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] as number;

async function main() {
  const { prisma, drop } = await createTestDb();
  try {
    const org = await newOrg(prisma);
    process.stdout.write(`seeding ${CLIENTS} clients with 4 weeks of 3 workouts...\n`);
    for (let i = 0; i < CLIENTS; i++) {
      await newClientWorld(prisma, org, { weeks: grid(4, 3) });
    }
    // Two weeks later: missed sessions and their flags exist, like a real queue.
    const later = new Date(NOW.getTime() + 14 * 86_400_000);
    await withTenant(org.orgId, (tx) => evaluateRules(tx, org.orgId, later), prisma, {
      userId: org.coach.userId,
    });
    const sessions = await withSystem((tx) => tx.workoutSession.count(), prisma);
    process.stdout.write(`seeded ${sessions} sessions\n`);

    const times: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const t0 = performance.now();
      await withTenant(
        org.orgId,
        async (tx) => {
          await tx.client.count();
          await getReviewCounts(tx, org.coach, { now: later });
          await countOpenFlags(tx, org.coach);
          await listFlags(tx, org.coach);
          await unreadMessageCount(tx, org.coach);
          await countRecentMissed(tx, org.coach, later);
          // The redesigned dashboard (Docs/ui-redesign-plan.md §4.2): KPI tiles, This week, client pulse, activity.
          await listCheckinsAwaitingReview(tx, org.coach, { limit: 5 });
          await getAdherenceSeries(tx, org.coach, { weeks: 8, now: later });
          await getDailySessionStates(tx, org.coach, { now: later });
          const wk = isoWeekOf(later.toISOString().slice(0, 10));
          await getAnalytics(tx, org.coach, { from: wk.start, to: wk.end }, { now: later });
          await getAnalytics(tx, org.coach, { from: wk.start, to: wk.end }, { now: later });
          const active = await tx.client.findMany({
            where: { status: 'active' },
            select: { id: true },
            take: 200,
          });
          await getClientAdherence(
            tx,
            org.coach,
            active.map((c) => c.id),
            { days: 28, now: later },
          );
          const recent = await tx.workoutSession.findMany({
            where: { state: 'completed' },
            orderBy: { completedAt: 'desc' },
            take: 8,
            select: { clientId: true },
          });
          for (const id of new Set(recent.map((r) => r.clientId)))
            await getPersonalRecords(tx, org.coach, id);
        },
        prisma,
        { userId: org.coach.userId },
      );
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const [p50, p75, p95] = [50, 75, 95].map((p) => Math.round(pct(times, p)));
    process.stdout.write(
      `dashboard data load over ${RUNS} runs: p50 ${p50} ms, p75 ${p75} ms, p95 ${p95} ms\n`,
    );
    if ((p75 as number) > BUDGET_MS) {
      process.stdout.write(`FAIL: p75 above ${BUDGET_MS} ms\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write(`OK: p75 within ${BUDGET_MS} ms\n`);
    }
  } finally {
    await drop();
    await prisma.$disconnect();
  }
}

void main();
