import type { Metadata } from 'next';
import Link from 'next/link';
import { listCourses } from '@kinetic/core';
import { EmptyState } from '@/components/states/EmptyState';
import { buttonVariants } from '@/components/ui/button';
import { withServerTenant } from '@/server/serverActor';

// May block on request data (session, params); opts out of Next instant-navigation validation, see HANDOFF.
export const instant = false;

export const metadata: Metadata = { title: 'Courses | Kinetic' };

/** PRD G4: lesson courses that unlock one lesson a day or a week. */
export default async function CoursesPage() {
  const courses = await withServerTenant((tx, actor) => listCourses(tx, actor));
  const add = (
    <Link href="/app/courses/new" className={buttonVariants({ variant: 'default' })}>
      New course
    </Link>
  );
  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold md:text-3xl">Courses</h1>
        {courses.length > 0 && add}
      </div>
      {courses.length === 0 ? (
        <EmptyState
          title="No courses yet"
          body="Write a few short lessons (text, a video or a PDF link). Enrolled clients get one a day or one a week and mark each done."
          action={add}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {courses.map((c) => (
            <li key={c.id} className="rounded-card bg-surface p-4 shadow-card">
              <Link
                href={`/app/courses/${c.id}`}
                className="font-semibold underline-offset-4 hover:underline"
              >
                {c.title}
              </Link>
              <p className="text-sm text-secondary">
                {c.lessonCount} {c.lessonCount === 1 ? 'lesson' : 'lessons'}, one a{' '}
                {c.cadence === 'daily' ? 'day' : 'week'} · {c.enrolled} enrolled
              </p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
