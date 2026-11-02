'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { call } from '@/lib/checkin-api';

const del = (path: string) =>
  fetch(path, { method: 'DELETE', credentials: 'same-origin' }).then((r) => r.ok);

export function ArchiveCourse({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  return (
    <Button
      variant="secondary"
      aria-label={`Delete the course ${title}`}
      onClick={async () => {
        if (!window.confirm(`Delete "${title}"? It leaves every client's portal.`)) return;
        if (await del(`/api/v1/courses/${id}`)) {
          toast.success('Course deleted');
          router.push('/app/courses');
          router.refresh();
        } else toast.error("Couldn't delete it. Try again.");
      }}
    >
      Delete
    </Button>
  );
}

/** Enrol a client from the course page. */
export function EnrollClient({
  courseId,
  clients,
}: {
  courseId: string;
  clients: { id: string; name: string }[];
}) {
  const router = useRouter();
  const uid = useId();
  const [clientId, setClientId] = useState('');
  const [start, setStart] = useState('');
  const [busy, setBusy] = useState(false);
  if (clients.length === 0) return null;
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={`${uid}-client`} className="text-sm font-medium">
          Client
        </label>
        <select
          id={`${uid}-client`}
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          className="block min-h-11 max-w-full rounded-control border border-input-border bg-surface px-3 text-base text-ink"
        >
          <option value="">Choose…</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${uid}-start`} className="text-sm font-medium">
          Start date (default today)
        </label>
        <input
          id={`${uid}-start`}
          type="date"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          className="block min-h-11 rounded-control border border-input-border bg-surface px-3 text-base text-ink"
        />
      </div>
      <Button
        disabled={busy || !clientId}
        onClick={async () => {
          setBusy(true);
          const res = await call<{ created: boolean }>(
            'POST',
            `/api/v1/courses/${courseId}/enrollments`,
            { clientId, ...(start ? { startLocalDate: start } : {}) },
          );
          setBusy(false);
          if (res.ok) {
            toast.success(res.data.created ? 'Client enrolled' : 'Already enrolled');
            setClientId('');
            router.refresh();
          } else toast.error(res.message);
        }}
      >
        Enrol
      </Button>
    </div>
  );
}

export function EndEnrollment({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={`Remove from course: ${label}`}
      onClick={async () => {
        if (await del(`/api/v1/course-enrollments/${id}`)) {
          toast.success('Removed from the course');
          router.refresh();
        } else toast.error("Couldn't remove it. Try again.");
      }}
    >
      Remove from course
    </Button>
  );
}
