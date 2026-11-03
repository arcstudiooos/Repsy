import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getCourse, isUuid, TRAINER_ROLES } from '@kinetic/core';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { loadActiveClients } from '@/server/selectOptions';
import { withServerTenant } from '@/server/serverActor';
import { ArchiveCourse, EndEnrollment, EnrollClient } from '../CourseActions';
import { CourseEditor } from '../CourseEditor';

// May block on request data (session, params); opts out of Next instant-navigation validation, see HANDOFF.
export const instant = false;

export const metadata: Metadata = { title: 'Course | Kinetic' };

const day = (d: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${d}T00:00:00Z`),
  );

/** PRD G4: edit a course, enrol clients and see how far each is. */
export default async function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (id !== 'new' && !isUuid(id)) notFound();
  const data = await withServerTenant(async (tx, actor) => ({
    course: id === 'new' ? null : await getCourse(tx, actor, id).catch(() => null),
    clients: (await loadActiveClients(tx, actor)).items.map((c) => ({ id: c.id, name: c.name })),
    canEdit: (TRAINER_ROLES as readonly string[]).includes(actor.role),
  }));
  if (id !== 'new' && !data.course) notFound();
  const c = data.course;
  const enrolled = new Set(c?.enrollments.map((e) => e.clientId));
  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold break-words md:text-3xl">
          {c ? c.title : 'New course'}
        </h1>
        {c && data.canEdit && <ArchiveCourse id={c.id} title={c.title} />}
      </div>
      <div className="flex flex-col gap-8">
        {c && (
          <Card>
            <CardHeader>
              <CardTitle as="h2">Enrolled clients</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {data.canEdit && (
                <EnrollClient
                  courseId={c.id}
                  clients={data.clients.filter((x) => !enrolled.has(x.id))}
                />
              )}
              {c.enrollments.length === 0 ? (
                <p className="text-secondary">No one is taking this course yet.</p>
              ) : (
                <ul aria-label="Enrolled clients" className="flex flex-col divide-y divide-divider">
                  {c.enrollments.map((e) => (
                    <li
                      key={e.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-2"
                    >
                      <span className="min-w-0 break-words">
                        <span className="font-medium">{e.clientName}</span>
                        <span className="text-sm text-secondary">
                          {' '}
                          · started {day(e.startLocalDate)} · {e.done} of {e.total} done ·{' '}
                          {e.unlocked} open
                        </span>
                      </span>
                      {data.canEdit && <EndEnrollment id={e.id} label={e.clientName} />}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
        {data.canEdit && (
          <CourseEditor
            id={c?.id ?? null}
            initial={c ?? { title: '', description: '', cadence: 'weekly', lessons: [] }}
          />
        )}
      </div>
    </>
  );
}
