import Link from 'next/link';
import type { EnrollmentProgress } from '@repsy/core';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/** PRD G4: the client's courses and how far they are. Enrol from a course's page. */
export function ClientCourses({ courses }: { courses: EnrollmentProgress[] }) {
  if (courses.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Courses</CardTitle>
      </CardHeader>
      <CardContent>
        <ul aria-label="Courses" className="flex flex-col gap-2">
          {courses.map((c) => (
            <li key={c.id}>
              <Link
                href={`/app/courses/${c.courseId}`}
                className="font-medium underline underline-offset-4"
              >
                {c.courseTitle}
              </Link>
              <span className="text-sm text-secondary">
                {' '}
                · {c.done} of {c.total} lessons done
                {c.ended ? ' · ended' : ` · ${c.unlocked} open`}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
