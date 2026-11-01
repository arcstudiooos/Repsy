'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { AgreementView } from '@kinetic/core';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { call } from '@/lib/checkin-api';

/**
 * PRD B14: before the portal opens, the client reads and accepts their coach's terms and waivers (again when one
 * changes). Each is accepted on its own; the version shown is the version recorded.
 */
export function AgreementGate({
  coachName,
  pending,
}: {
  coachName: string;
  pending: AgreementView[];
}) {
  const router = useRouter();
  const [left, setLeft] = useState(pending);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function accept(a: AgreementView) {
    setBusy(a.id);
    setError(null);
    const res = await call('POST', `/api/v1/agreements/${a.id}/accept`, { version: a.version });
    setBusy(null);
    if (!res.ok) {
      setError(res.message);
      router.refresh();
      return;
    }
    const rest = left.filter((x) => x.id !== a.id);
    setLeft(rest);
    if (rest.length === 0) router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Before you start</h1>
      <p className="text-secondary">
        {coachName} asks you to read and accept {left.length === 1 ? 'this' : 'these'} first.
      </p>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      {left.map((a) => (
        <Card key={a.id}>
          <CardHeader>
            <CardTitle as="h2">{a.title}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div
              tabIndex={0}
              role="region"
              aria-label={`${a.title} text`}
              className="max-h-80 overflow-y-auto rounded-control border border-divider p-3 whitespace-pre-line"
            >
              {a.body}
            </div>
            <Button disabled={busy !== null} onClick={() => void accept(a)}>
              {busy === a.id ? 'Saving…' : `I accept the ${a.title}`}
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
