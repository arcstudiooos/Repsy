'use client';

import type { ClassView } from '@repsy/core';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { toast } from '@/components/ui/toast';
import { EmptyState } from '@/components/states/EmptyState';
import { enrollInClass, leaveClass } from '@/lib/classes-api';
import { classWhen } from './ClassesBoard';

/** PRD K12: a client books a place in a class, joins the waitlist, or gives a place back. */
export function PortalClasses({ classes }: { classes: ClassView[] }) {
  if (classes.length === 0) {
    return (
      <EmptyState
        title="No classes coming up"
        body="When your coach schedules group classes, you can book a place here."
      />
    );
  }
  return (
    <ul className="flex flex-col gap-3">
      {classes.map((c) => (
        <li key={c.id}>
          <PortalClassCard item={c} />
        </li>
      ))}
    </ul>
  );
}

function PortalClassCard({ item }: { item: ClassView }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const full = item.booked >= item.capacity;
  const left = Math.max(item.capacity - item.booked, 0);

  async function book() {
    setBusy(true);
    const res = await enrollInClass(item.id);
    setBusy(false);
    if (!res.ok) return toast.error(res.message);
    toast.success(
      res.data.status === 'booked'
        ? 'You are booked in.'
        : 'The class is full. You are on the waitlist and move up if a place opens.',
    );
    router.refresh();
  }

  async function leave() {
    setBusy(true);
    const res = await leaveClass(item.id);
    setBusy(false);
    if (!res.ok) return toast.error(res.message);
    toast.success(
      item.myStatus === 'booked' ? 'Your place is cancelled.' : 'You left the waitlist.',
    );
    router.refresh();
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-h3 font-semibold break-words">{item.title}</h2>
          <p className="text-sm text-secondary" suppressHydrationWarning>
            {classWhen(item)}
            {item.locationName ? ` · ${item.locationName}` : ''}
            {item.coachName ? ` · ${item.coachName}` : ''}
          </p>
          {item.description && <p className="mt-2 text-sm break-words">{item.description}</p>}
        </div>
        {item.myStatus === 'booked' ? (
          <Badge tone="success">Booked</Badge>
        ) : item.myStatus === 'waitlisted' ? (
          <Badge tone="info">On the waitlist</Badge>
        ) : (
          <Badge tone={full ? 'warning' : 'neutral'}>
            {full ? 'Full' : `${left} ${left === 1 ? 'place' : 'places'} left`}
          </Badge>
        )}
      </div>
      <div className="mt-3">
        {item.myStatus ? (
          <Button variant="secondary" disabled={busy} onClick={leave}>
            {item.myStatus === 'booked' ? 'Cancel my place' : 'Leave the waitlist'}
          </Button>
        ) : (
          <Button disabled={busy} onClick={book}>
            {full ? 'Join the waitlist' : 'Book a place'}
          </Button>
        )}
      </div>
    </Card>
  );
}
