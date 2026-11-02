'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { call } from '@/lib/checkin-api';

/** PRD G4: mark an open lesson done, or undo it. */
export function LessonDone({
  enrollmentId,
  lessonId,
  title,
  done,
}: {
  enrollmentId: string;
  lessonId: string;
  title: string;
  done: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant={done ? 'secondary' : 'default'}
      disabled={busy}
      aria-label={done ? `Mark as not done: ${title}` : `Mark as done: ${title}`}
      onClick={async () => {
        setBusy(true);
        const res = await call(
          'PUT',
          `/api/v1/course-enrollments/${enrollmentId}/lessons/${lessonId}`,
          { done: !done },
        );
        setBusy(false);
        if (res.ok) router.refresh();
        else toast.error(res.message);
      }}
    >
      {done ? 'Mark as not done' : 'Mark as done'}
    </Button>
  );
}
