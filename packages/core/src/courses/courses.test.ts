import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { DomainError } from '../errors';
import { newClientWorld, newOrg, runAs } from '../sessions/fixtures.test-helpers';
import {
  archiveCourse,
  clientCourses,
  endEnrollment,
  enrollClient,
  getCourse,
  listCourses,
  myCourses,
  saveCourse,
  setLessonDone,
  unlockDate,
  unlockedCount,
} from './courses';

let prisma: PrismaClient;
let drop: () => Promise<void>;
beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

// 2026-11-04 is a Wednesday; noon UTC is morning in New York.
const NOW = new Date('2026-11-04T15:00:00Z');
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
const lessons = [
  { title: 'Protein basics', body: 'Aim for a palm at each meal.' },
  { title: 'Sleep', body: '', url: 'https://example.test/sleep.mp4' },
  { title: 'Steps', body: 'Walk after dinner.' },
];

describe('unlock schedule (PRD G4)', () => {
  it('opens one lesson a day or a week from the start date', () => {
    expect(unlockDate('2026-11-04', 0, 'weekly')).toBe('2026-11-04');
    expect(unlockDate('2026-11-04', 2, 'weekly')).toBe('2026-11-18');
    expect(unlockDate('2026-11-30', 1, 'daily')).toBe('2026-12-01');
    expect(unlockedCount('2026-11-04', '2026-11-03', 'daily', 3)).toBe(0);
    expect(unlockedCount('2026-11-04', '2026-11-04', 'weekly', 3)).toBe(1);
    expect(unlockedCount('2026-11-04', '2026-11-10', 'weekly', 3)).toBe(1);
    expect(unlockedCount('2026-11-04', '2026-11-11', 'weekly', 3)).toBe(2);
    expect(unlockedCount('2026-11-04', '2027-01-01', 'daily', 3)).toBe(3);
  });
});

describe('courses (PRD G4)', () => {
  it('drips lessons to an enrolled client, who marks them done; the coach sees progress', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org);
    await expect(
      runAs(prisma, org.coach, (tx) =>
        saveCourse(tx, org.coach, {
          title: 'Habits',
          cadence: 'weekly',
          lessons: [{ title: 'x' }],
        }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    const { id } = await runAs(prisma, org.coach, (tx) =>
      saveCourse(tx, org.coach, {
        title: 'Habits 101',
        description: 'Three weeks of basics',
        cadence: 'weekly',
        lessons,
      }),
    );
    await runAs(prisma, org.coach, (tx) =>
      enrollClient(tx, org.coach, { courseId: id, clientId: w.clientId }, { now: NOW }),
    );
    // Enrolling twice keeps the one enrolment.
    const again = await runAs(prisma, org.coach, (tx) =>
      enrollClient(tx, org.coach, { courseId: id, clientId: w.clientId }, { now: NOW }),
    );
    expect(again.created).toBe(false);

    const [course] = await runAs(prisma, w.client, (tx) => myCourses(tx, w.client, NOW));
    expect(course).toMatchObject({ title: 'Habits 101', done: 0, total: 3 });
    expect(course!.lessons.map((l) => [l.title, l.unlocked, l.unlockDate, l.body])).toEqual([
      ['Protein basics', true, '2026-11-04', 'Aim for a palm at each meal.'],
      ['Sleep', false, '2026-11-11', null],
      ['Steps', false, '2026-11-18', null],
    ]);
    const [first, second] = course!.lessons;
    const done = (lessonId: string, at: Date, d = true) =>
      runAs(prisma, w.client, (tx) =>
        setLessonDone(tx, w.client, { enrollmentId: course!.enrollmentId, lessonId, done: d }, at),
      );
    await done(first!.id, NOW);
    await done(first!.id, NOW); // idempotent
    await expect(done(second!.id, NOW)).rejects.toMatchObject({ code: 'CONFLICT' });
    await done(second!.id, days(7));
    const later = await runAs(prisma, w.client, (tx) => myCourses(tx, w.client, days(7)));
    expect(later[0]!.lessons[1]).toMatchObject({
      unlocked: true,
      url: 'https://example.test/sleep.mp4',
      done: true,
    });

    const progress = await runAs(prisma, org.coach, (tx) =>
      clientCourses(tx, org.coach, w.clientId, days(7)),
    );
    expect(progress).toMatchObject([{ courseTitle: 'Habits 101', unlocked: 2, done: 2, total: 3 }]);
    expect(await runAs(prisma, org.coach, (tx) => listCourses(tx, org.coach))).toMatchObject([
      { title: 'Habits 101', lessonCount: 3, enrolled: 1 },
    ]);

    // Editing keeps completions for kept lessons and drops removed ones.
    const detail = await runAs(prisma, org.coach, (tx) => getCourse(tx, org.coach, id, days(7)));
    await runAs(prisma, org.coach, (tx) =>
      saveCourse(tx, org.coach, {
        id,
        title: 'Habits 101',
        cadence: 'daily',
        lessons: [
          { ...detail.lessons[1]!, title: 'Sleep well' },
          { title: 'Water', body: 'Two litres.' },
        ],
      }),
    );
    const edited = await runAs(prisma, w.client, (tx) => myCourses(tx, w.client, NOW));
    expect(edited[0]).toMatchObject({ cadence: 'daily', done: 1, total: 2 });
    expect(edited[0]!.lessons.map((l) => [l.title, l.done])).toEqual([
      ['Sleep well', true],
      ['Water', false],
    ]);

    // A client can't mark another client's lesson.
    const other = await newClientWorld(prisma, org);
    await expect(
      runAs(prisma, other.client, (tx) =>
        setLessonDone(tx, other.client, {
          enrollmentId: course!.enrollmentId,
          lessonId: second!.id,
        }),
      ),
    ).rejects.toBeInstanceOf(DomainError);

    await runAs(prisma, org.coach, (tx) => endEnrollment(tx, org.coach, course!.enrollmentId));
    expect(await runAs(prisma, w.client, (tx) => myCourses(tx, w.client, NOW))).toEqual([]);
    await runAs(prisma, org.coach, (tx) => archiveCourse(tx, org.coach, id));
    expect(await runAs(prisma, org.coach, (tx) => listCourses(tx, org.coach))).toEqual([]);
  });

  it('is coach-managed: a client cannot create or enrol', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org);
    await expect(
      runAs(prisma, w.client, (tx) =>
        saveCourse(tx, w.client, { title: 'x', cadence: 'daily', lessons }),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
