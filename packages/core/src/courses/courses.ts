import { appendAudit, type TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { fromDbDate, toDbDate } from '../sessions/read';
import { todayInZone } from '../timezone';
import { isUuid } from '../uuid';

/**
 * PRD G4: lessons and courses. A course is an ordered list of lessons (text, with an optional video or PDF link). An
 * enrolled client gets lesson 1 on their start date and the next one each day or each week after; they mark each
 * done and the coach sees how far they are.
 */
export const COURSE_CADENCES = ['daily', 'weekly'] as const;
export type CourseCadence = (typeof COURSE_CADENCES)[number];
export const COURSE_TITLE_MAX = 120;
export const COURSE_DESCRIPTION_MAX = 2000;
export const LESSON_BODY_MAX = 20_000;
export const LESSONS_MAX = 60;
export const COURSES_MAX = 100;

export interface LessonInput {
  id?: string;
  title: string;
  body: string;
  url: string | null;
}

export interface CourseSummary {
  id: string;
  title: string;
  description: string;
  cadence: CourseCadence;
  lessonCount: number;
  enrolled: number;
}

export interface CourseDetail extends CourseSummary {
  lessons: (LessonInput & { id: string })[];
  enrollments: EnrollmentProgress[];
}

export interface EnrollmentProgress {
  id: string;
  courseId: string;
  courseTitle: string;
  clientId: string;
  clientName: string;
  startLocalDate: string;
  cadence: CourseCadence;
  total: number;
  unlocked: number;
  done: number;
  ended: boolean;
}

export interface PortalLesson {
  id: string;
  position: number;
  title: string;
  /** Locked lessons carry no body or link. */
  body: string | null;
  url: string | null;
  unlockDate: string;
  unlocked: boolean;
  done: boolean;
}

export interface PortalCourse {
  enrollmentId: string;
  title: string;
  description: string;
  cadence: CourseCadence;
  done: number;
  total: number;
  lessons: PortalLesson[];
}

const notFound = () => new DomainError('NOT_FOUND', 'Not found.');
const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });
const DAY_MS = 86_400_000;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The local date lesson `index` (0-based) unlocks for an enrolment starting on `start`. */
export function unlockDate(start: string, index: number, cadence: CourseCadence): string {
  const step = cadence === 'daily' ? 1 : 7;
  return new Date(toDbDate(start).getTime() + index * step * DAY_MS).toISOString().slice(0, 10);
}

/** How many of `total` lessons are open on local date `today`. */
export function unlockedCount(
  start: string,
  today: string,
  cadence: CourseCadence,
  total: number,
): number {
  if (today < start) return 0;
  const days = Math.round((toDbDate(today).getTime() - toDbDate(start).getTime()) / DAY_MS);
  return Math.min(total, Math.floor(days / (cadence === 'daily' ? 1 : 7)) + 1);
}

function cleanUrl(raw: unknown, field: string): string | null {
  const url = typeof raw === 'string' ? raw.trim() : '';
  if (url === '') return null;
  let ok = false;
  try {
    ok = new URL(url).protocol === 'https:' && url.length <= 500;
  } catch {
    ok = false;
  }
  if (!ok) throw invalid(field, 'Use a full https:// link.');
  return url;
}

function cleanCourse(input: Record<string, unknown>) {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (title.length < 1 || title.length > COURSE_TITLE_MAX) {
    throw invalid('title', `Use 1-${COURSE_TITLE_MAX} characters.`);
  }
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  if (description.length > COURSE_DESCRIPTION_MAX) {
    throw invalid('description', `Use at most ${COURSE_DESCRIPTION_MAX} characters.`);
  }
  const cadence = input.cadence as CourseCadence;
  if (!COURSE_CADENCES.includes(cadence)) throw invalid('cadence', 'Pick daily or weekly.');
  if (!Array.isArray(input.lessons) || input.lessons.length === 0) {
    throw invalid('lessons', 'Add at least one lesson.');
  }
  if (input.lessons.length > LESSONS_MAX) {
    throw invalid('lessons', `Use at most ${LESSONS_MAX} lessons.`);
  }
  const lessons: LessonInput[] = input.lessons.map((raw, i) => {
    const l = (raw ?? {}) as Record<string, unknown>;
    const t = typeof l.title === 'string' ? l.title.trim() : '';
    if (t.length < 1 || t.length > COURSE_TITLE_MAX) {
      throw invalid(`lessons.${i}.title`, `Name lesson ${i + 1}.`);
    }
    const body = typeof l.body === 'string' ? l.body.trim() : '';
    if (body.length > LESSON_BODY_MAX) {
      throw invalid(`lessons.${i}.body`, `Use at most ${LESSON_BODY_MAX} characters.`);
    }
    const url = cleanUrl(l.url, `lessons.${i}.url`);
    if (body === '' && url === null) {
      throw invalid(`lessons.${i}.body`, 'Add some text or a link.');
    }
    return { id: isUuid(l.id) ? (l.id as string) : undefined, title: t, body, url };
  });
  return { title, description, cadence, lessons };
}

/** The organization's courses, by title. */
export async function listCourses(tx: TenantTx, actor: ActorContext): Promise<CourseSummary[]> {
  assertCan(actor, 'client:read');
  const rows = await tx.course.findMany({
    where: { archivedAt: null },
    orderBy: [{ title: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      title: true,
      description: true,
      cadence: true,
      _count: { select: { lessons: true, enrollments: { where: { endedAt: null } } } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    cadence: r.cadence as CourseCadence,
    lessonCount: r._count.lessons,
    enrolled: r._count.enrollments,
  }));
}

const ENROLLMENT_SELECT = {
  id: true,
  startLocalDate: true,
  endedAt: true,
  client: { select: { id: true, name: true, timezone: true } },
  course: {
    select: { id: true, title: true, cadence: true, _count: { select: { lessons: true } } },
  },
  _count: { select: { completions: true } },
} as const;

type EnrollmentRow = {
  id: string;
  startLocalDate: Date;
  endedAt: Date | null;
  client: { id: string; name: string; timezone: string };
  course: { id: string; title: string; cadence: string; _count: { lessons: number } };
  _count: { completions: number };
};

function progressOf(r: EnrollmentRow, now: Date): EnrollmentProgress {
  const start = fromDbDate(r.startLocalDate);
  const cadence = r.course.cadence as CourseCadence;
  const total = r.course._count.lessons;
  return {
    id: r.id,
    courseId: r.course.id,
    courseTitle: r.course.title,
    clientId: r.client.id,
    clientName: r.client.name,
    startLocalDate: start,
    cadence,
    total,
    unlocked: unlockedCount(start, todayInZone(r.client.timezone, now), cadence, total),
    done: r._count.completions,
    ended: r.endedAt !== null,
  };
}

/** One course with its lessons and who is taking it. */
export async function getCourse(
  tx: TenantTx,
  actor: ActorContext,
  id: string,
  now: Date = new Date(),
): Promise<CourseDetail> {
  assertCan(actor, 'client:read');
  if (!isUuid(id)) throw notFound();
  const course = await tx.course.findFirst({
    where: { id, archivedAt: null },
    select: {
      id: true,
      title: true,
      description: true,
      cadence: true,
      lessons: {
        orderBy: { position: 'asc' },
        select: { id: true, title: true, body: true, url: true },
      },
      enrollments: {
        where: { endedAt: null },
        orderBy: { createdAt: 'asc' },
        select: ENROLLMENT_SELECT,
      },
    },
  });
  if (!course) throw notFound();
  return {
    id: course.id,
    title: course.title,
    description: course.description,
    cadence: course.cadence as CourseCadence,
    lessonCount: course.lessons.length,
    enrolled: course.enrollments.length,
    lessons: course.lessons,
    enrollments: course.enrollments.map((e) => progressOf(e, now)),
  };
}

/**
 * Creates a course, or replaces an existing one's details and lessons. Lessons that keep their id keep their
 * completions; removed lessons go, with their completions.
 */
export async function saveCourse(
  tx: TenantTx,
  actor: ActorContext,
  input: Record<string, unknown>,
  opts: { requestId?: string } = {},
): Promise<{ id: string }> {
  assertCan(actor, 'client:update');
  const c = cleanCourse(input);
  let id: string;
  if (input.id !== undefined) {
    if (!isUuid(input.id)) throw notFound();
    const existing = await tx.course.findFirst({
      where: { id: input.id, archivedAt: null },
      select: { id: true, lessons: { select: { id: true } } },
    });
    if (!existing) throw notFound();
    id = existing.id;
    const known = new Set(existing.lessons.map((l) => l.id));
    if (c.lessons.some((l) => l.id !== undefined && !known.has(l.id))) {
      throw invalid('lessons', 'One of these lessons is not part of this course.');
    }
    await tx.course.update({
      where: { id },
      data: { title: c.title, description: c.description, cadence: c.cadence },
    });
    const kept = new Set(c.lessons.flatMap((l) => (l.id ? [l.id] : [])));
    await tx.courseLesson.deleteMany({ where: { courseId: id, id: { notIn: [...kept] } } });
    // Park kept lessons out of the way so positions can be rewritten in any order.
    await tx.courseLesson.updateMany({
      where: { courseId: id },
      data: { position: { increment: 100_000 } },
    });
  } else {
    if ((await tx.course.count({ where: { archivedAt: null } })) >= COURSES_MAX) {
      throw invalid('title', `A workspace can have at most ${COURSES_MAX} courses.`);
    }
    const row = await tx.course.create({
      data: {
        title: c.title,
        description: c.description,
        cadence: c.cadence,
        createdBy: actor.userId,
      },
      select: { id: true },
    } as Parameters<typeof tx.course.create>[0]);
    id = (row as { id: string }).id;
  }
  for (const [position, l] of c.lessons.entries()) {
    const data = { position, title: l.title, body: l.body, url: l.url };
    if (l.id) await tx.courseLesson.update({ where: { id: l.id }, data });
    else {
      await tx.courseLesson.create({
        data: { ...data, courseId: id },
      } as Parameters<typeof tx.courseLesson.create>[0]);
    }
  }
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'course',
    objectId: id,
    action: input.id === undefined ? 'course.created' : 'course.updated',
    metadata: { lessons: c.lessons.length },
    requestId: opts.requestId,
  });
  return { id };
}

/** Archives a course: it leaves the list and every client's portal. Completions stay. */
export async function archiveCourse(
  tx: TenantTx,
  actor: ActorContext,
  id: string,
  opts: { requestId?: string; now?: Date } = {},
): Promise<void> {
  assertCan(actor, 'client:update');
  if (!isUuid(id)) throw notFound();
  const now = opts.now ?? new Date();
  const { count } = await tx.course.updateMany({
    where: { id, archivedAt: null },
    data: { archivedAt: now },
  });
  if (count === 0) throw notFound();
  await tx.courseEnrollment.updateMany({
    where: { courseId: id, endedAt: null },
    data: { endedAt: now },
  });
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'course',
    objectId: id,
    action: 'course.archived',
    requestId: opts.requestId,
  });
}

/**
 * Enrols a client. The start date defaults to today in the client's zone. Already enrolled: nothing changes and the
 * open enrolment is returned (automations may enrol the same client twice).
 */
export async function enrollClient(
  tx: TenantTx,
  actor: ActorContext,
  input: { courseId?: unknown; clientId?: unknown; startLocalDate?: unknown },
  opts: { requestId?: string; now?: Date } = {},
): Promise<{ id: string; created: boolean }> {
  assertCan(actor, 'client:update');
  const now = opts.now ?? new Date();
  if (!isUuid(input.courseId)) throw invalid('courseId', 'Pick a course.');
  if (!isUuid(input.clientId)) throw notFound();
  const course = await tx.course.findFirst({
    where: { id: input.courseId, archivedAt: null },
    select: { id: true },
  });
  if (!course) throw invalid('courseId', 'That course no longer exists.');
  const client = await tx.client.findFirst({
    where: { id: input.clientId, status: { in: ['active', 'invited'] } },
    select: { id: true, timezone: true },
  });
  if (!client) throw notFound();
  let start = todayInZone(client.timezone, now);
  if (input.startLocalDate !== undefined && input.startLocalDate !== '') {
    if (typeof input.startLocalDate !== 'string' || !LOCAL_DATE.test(input.startLocalDate)) {
      throw invalid('startLocalDate', 'Pick a start date.');
    }
    if (Number.isNaN(toDbDate(input.startLocalDate).getTime())) {
      throw invalid('startLocalDate', 'Pick a start date.');
    }
    start = input.startLocalDate;
  }
  const open = await tx.courseEnrollment.findFirst({
    where: { courseId: course.id, clientId: client.id, endedAt: null },
    select: { id: true },
  });
  if (open) return { id: open.id, created: false };
  const row = await tx.courseEnrollment.create({
    data: { courseId: course.id, clientId: client.id, startLocalDate: toDbDate(start) },
    select: { id: true },
  } as Parameters<typeof tx.courseEnrollment.create>[0]);
  const id = (row as { id: string }).id;
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'client',
    objectId: client.id,
    action: 'course.enrolled',
    metadata: { courseId: course.id, enrollmentId: id },
    requestId: opts.requestId,
  });
  return { id, created: true };
}

/** Ends an enrolment: the course leaves the client's portal. */
export async function endEnrollment(
  tx: TenantTx,
  actor: ActorContext,
  enrollmentId: string,
  opts: { requestId?: string; now?: Date } = {},
): Promise<void> {
  assertCan(actor, 'client:update');
  if (!isUuid(enrollmentId)) throw notFound();
  const row = await tx.courseEnrollment.findFirst({
    where: { id: enrollmentId, endedAt: null },
    select: { id: true, clientId: true },
  });
  if (!row) throw notFound();
  await tx.courseEnrollment.update({
    where: { id: row.id },
    data: { endedAt: opts.now ?? new Date() },
  });
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'client',
    objectId: row.clientId,
    action: 'course.unenrolled',
    metadata: { enrollmentId: row.id },
    requestId: opts.requestId,
  });
}

/** A client's courses, for their profile (open ones first, then finished ones). */
export async function clientCourses(
  tx: TenantTx,
  actor: ActorContext,
  clientId: string,
  now: Date = new Date(),
): Promise<EnrollmentProgress[]> {
  assertCan(actor, 'client:read');
  if (!isUuid(clientId)) throw notFound();
  const rows = await tx.courseEnrollment.findMany({
    where: { clientId },
    orderBy: [{ createdAt: 'desc' }],
    take: 50,
    select: ENROLLMENT_SELECT,
  });
  return rows.map((r) => progressOf(r, now)).sort((a, b) => Number(a.ended) - Number(b.ended));
}

/** The signed-in client's open courses with their lessons; locked lessons show only their title and date. */
export async function myCourses(
  tx: TenantTx,
  actor: ActorContext,
  now: Date = new Date(),
): Promise<PortalCourse[]> {
  assertCan(actor, 'session:read');
  if (actor.role !== 'client' || !actor.clientId) throw notFound();
  const client = await tx.client.findFirstOrThrow({
    where: { id: actor.clientId },
    select: { timezone: true },
  });
  const today = todayInZone(client.timezone, now);
  const rows = await tx.courseEnrollment.findMany({
    where: { clientId: actor.clientId, endedAt: null, course: { archivedAt: null } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      startLocalDate: true,
      completions: { select: { lessonId: true } },
      course: {
        select: {
          title: true,
          description: true,
          cadence: true,
          lessons: {
            orderBy: { position: 'asc' },
            select: { id: true, title: true, body: true, url: true },
          },
        },
      },
    },
  });
  return rows.map((r) => {
    const start = fromDbDate(r.startLocalDate);
    const cadence = r.course.cadence as CourseCadence;
    const done = new Set(r.completions.map((c) => c.lessonId));
    const open = unlockedCount(start, today, cadence, r.course.lessons.length);
    return {
      enrollmentId: r.id,
      title: r.course.title,
      description: r.course.description,
      cadence,
      done: r.course.lessons.filter((l) => done.has(l.id)).length,
      total: r.course.lessons.length,
      lessons: r.course.lessons.map((l, i) => ({
        id: l.id,
        position: i + 1,
        title: l.title,
        body: i < open ? l.body : null,
        url: i < open ? l.url : null,
        unlockDate: unlockDate(start, i, cadence),
        unlocked: i < open,
        done: done.has(l.id),
      })),
    };
  });
}

/** The client marks an open lesson done (or not done). */
export async function setLessonDone(
  tx: TenantTx,
  actor: ActorContext,
  input: { enrollmentId?: unknown; lessonId?: unknown; done?: unknown },
  now: Date = new Date(),
): Promise<void> {
  assertCan(actor, 'session:log');
  if (actor.role !== 'client' || !actor.clientId) throw notFound();
  if (!isUuid(input.enrollmentId) || !isUuid(input.lessonId)) throw notFound();
  const enrollment = await tx.courseEnrollment.findFirst({
    where: {
      id: input.enrollmentId,
      clientId: actor.clientId,
      endedAt: null,
      course: { archivedAt: null },
    },
    select: {
      id: true,
      organizationId: true,
      startLocalDate: true,
      client: { select: { timezone: true } },
      course: {
        select: { cadence: true, lessons: { orderBy: { position: 'asc' }, select: { id: true } } },
      },
    },
  });
  if (!enrollment) throw notFound();
  const index = enrollment.course.lessons.findIndex((l) => l.id === input.lessonId);
  if (index < 0) throw notFound();
  const open = unlockedCount(
    fromDbDate(enrollment.startLocalDate),
    todayInZone(enrollment.client.timezone, now),
    enrollment.course.cadence as CourseCadence,
    enrollment.course.lessons.length,
  );
  if (index >= open) throw new DomainError('CONFLICT', 'This lesson is not open yet.');
  const lessonId = input.lessonId as string;
  if (input.done === false) {
    await tx.lessonCompletion.deleteMany({ where: { enrollmentId: enrollment.id, lessonId } });
    return;
  }
  await tx.lessonCompletion.createMany({
    data: [
      {
        enrollmentId: enrollment.id,
        lessonId,
        organizationId: enrollment.organizationId,
        completedAt: now,
      },
    ],
    skipDuplicates: true,
  });
}
