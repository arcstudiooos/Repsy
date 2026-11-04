import type { Metadata } from 'next';
import { myCourses } from '@kinetic/core';
import { EmptyState } from '@/components/states/EmptyState';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { withPortalTenant } from '@/server/serverActor';
import { LessonDone } from './LessonDone';

export const metadata: Metadata = { title: 'Lessons | Repsy' };

const day = (d: string) =>
  new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${d}T00:00:00Z`));

/** PRD G4: the client's courses, one lesson opening each day or week. */
export default async function PortalLearnPage() {
  const courses = await withPortalTenant((tx, actor) => myCourses(tx, actor));
  return (
    <>
      <h1 className="mb-6 text-h1 font-semibold md:text-display">Lessons</h1>
      {courses.length === 0 ? (
        <EmptyState
          title="No lessons yet"
          body="When your coach adds you to a course, its lessons appear here."
        />
      ) : (
        <div className="flex flex-col gap-8">
          {courses.map((c) => (
            <section key={c.enrollmentId} aria-labelledby={`course-${c.enrollmentId}`}>
              <h2 id={`course-${c.enrollmentId}`} className="text-xl font-semibold break-words">
                {c.title}
              </h2>
              <p className="mb-3 text-secondary">
                {c.done} of {c.total} done · a new lesson every{' '}
                {c.cadence === 'daily' ? 'day' : 'week'}
              </p>
              {c.description && <p className="mb-3 whitespace-pre-line">{c.description}</p>}
              <ol className="flex flex-col gap-3">
                {c.lessons.map((l) => (
                  <li key={l.id}>
                    <Card>
                      <CardHeader>
                        <CardDescription>
                          Lesson {l.position}
                          {l.done ? ' · done' : l.unlocked ? '' : ` · opens ${day(l.unlockDate)}`}
                        </CardDescription>
                        <CardTitle as="h3" className="text-lg break-words">
                          {l.title}
                        </CardTitle>
                      </CardHeader>
                      {l.unlocked && (
                        <CardContent className="flex flex-col gap-3">
                          {l.body && <p className="break-words whitespace-pre-line">{l.body}</p>}
                          {l.url && (
                            <a
                              href={l.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="break-all text-accent underline underline-offset-4"
                            >
                              Open the video or PDF
                              <span className="sr-only"> for {l.title} (opens in a new tab)</span>
                            </a>
                          )}
                          <div>
                            <LessonDone
                              enrollmentId={c.enrollmentId}
                              lessonId={l.id}
                              title={l.title}
                              done={l.done}
                            />
                          </div>
                        </CardContent>
                      )}
                    </Card>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
