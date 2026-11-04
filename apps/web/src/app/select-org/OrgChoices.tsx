'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FormMessage, secondaryButtonClass } from '@/components/auth-ui';

export interface OrgChoice {
  orgId: string;
  name: string;
  roles: string[];
}

export function OrgChoices({ choices }: { choices: OrgChoice[] }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(orgId: string) {
    setPending(orgId);
    setError(null);
    try {
      const res = await fetch('/api/v1/org/switch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orgId }),
      });
      if (!res.ok) throw new Error('switch failed');
      // Full navigation so server components re-read the new cookie.
      window.location.assign('/');
    } catch {
      setError('Could not switch workspace. Try again.');
      setPending(null);
      router.refresh();
    }
  }

  return (
    <>
      <p className="mb-4 text-base">You belong to more than one workspace. Pick where to go.</p>
      {error && <FormMessage tone="error">{error}</FormMessage>}
      <ul className="flex flex-col gap-3">
        {choices.map((c) => (
          <li key={c.orgId}>
            <button
              type="button"
              className={`${secondaryButtonClass} text-left`}
              disabled={pending !== null}
              onClick={() => void choose(c.orgId)}
            >
              <span className="block font-semibold">{c.name}</span>
              <span className="block text-sm text-secondary">
                {pending === c.orgId ? 'Opening' : c.roles.join(', ')}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
