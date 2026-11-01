'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { joinTeamAction } from './actions';

export function JoinButton({ token, label }: { token: string; label: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await joinTeamAction(token);
            if (res?.error) setError(res.error);
          })
        }
      >
        {pending ? 'Joining…' : label}
      </Button>
    </div>
  );
}
