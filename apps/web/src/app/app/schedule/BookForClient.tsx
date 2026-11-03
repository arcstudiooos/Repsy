'use client';

import { useId, useState } from 'react';
import type { SessionTypeView } from '@kinetic/core';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BookSession } from '@/portal/sessions/BookSession';

/** Staff book a session on a client's behalf (the notice period doesn't apply to them; overlaps still do). */
export function BookForClient({
  clients,
  types,
  timeZone,
}: {
  clients: { id: string; name: string }[];
  types: SessionTypeView[];
  timeZone: string;
}) {
  const uid = useId();
  const [clientId, setClientId] = useState('');
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Book for a client</CardTitle>
        <CardDescription>They get it in their portal and calendar feed.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${uid}-client`} className="text-sm font-medium">
            Client
          </label>
          <select
            id={`${uid}-client`}
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="block min-h-11 max-w-sm rounded-control border border-input-border bg-surface px-3 text-base text-ink"
          >
            <option value="">Choose…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        {clientId && (
          <BookSession key={clientId} types={types} timeZone={timeZone} clientId={clientId} />
        )}
      </CardContent>
    </Card>
  );
}
