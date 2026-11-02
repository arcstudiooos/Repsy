'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { call } from '@/lib/checkin-api';

/** Coach: create a group. */
export function NewGroupForm() {
  const router = useRouter();
  const id = useId();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const res = await call<{ id: string }>('POST', '/api/v1/groups', { name, description });
        setBusy(false);
        if (!res.ok) {
          toast.error(res.fieldErrors?.name?.[0] ?? res.message);
          return;
        }
        toast.success('Group created');
        router.push(`/app/groups/${res.data.id}?tab=members`);
      }}
    >
      <label htmlFor={`${id}-name`} className="text-sm font-medium">
        Group name
      </label>
      <Input
        id={`${id}-name`}
        value={name}
        maxLength={80}
        onChange={(e) => setName(e.target.value)}
      />
      <label htmlFor={`${id}-desc`} className="text-sm font-medium">
        What it is for (optional)
      </label>
      <Input
        id={`${id}-desc`}
        value={description}
        maxLength={1000}
        onChange={(e) => setDescription(e.target.value)}
      />
      <div>
        <Button type="submit" disabled={busy || !name.trim()}>
          Create group
        </Button>
      </div>
    </form>
  );
}

/** Coach: choose who is in the group. */
export function GroupMembers({
  groupId,
  clients,
  members,
}: {
  groupId: string;
  clients: { id: string; name: string }[];
  members: string[];
}) {
  const router = useRouter();
  const [picked, setPicked] = useState(new Set(members));
  const [busy, setBusy] = useState(false);
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 font-semibold">Members</legend>
      {clients.length === 0 && <p className="text-secondary">No active clients yet.</p>}
      <ul className="flex flex-col">
        {clients.map((c) => (
          <li key={c.id}>
            <label className="flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                className="size-5 accent-accent"
                checked={picked.has(c.id)}
                onChange={(e) =>
                  setPicked((s) => {
                    const next = new Set(s);
                    if (e.target.checked) next.add(c.id);
                    else next.delete(c.id);
                    return next;
                  })
                }
              />
              {c.name}
            </label>
          </li>
        ))}
      </ul>
      <div>
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const res = await call('PUT', `/api/v1/groups/${groupId}/members`, {
              clientIds: [...picked],
            });
            setBusy(false);
            if (res.ok) {
              toast.success('Members saved');
              router.refresh();
            } else toast.error(res.message);
          }}
        >
          Save members
        </Button>
      </div>
    </fieldset>
  );
}

export function ArchiveGroup({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  return (
    <Button
      variant="secondary"
      aria-label={`Delete the group ${name}`}
      onClick={async () => {
        if (!window.confirm(`Delete "${name}"? Members lose access to its chat and feed.`)) return;
        const res = await fetch(`/api/v1/groups/${id}`, {
          method: 'DELETE',
          credentials: 'same-origin',
        });
        if (res.ok) {
          toast.success('Group deleted');
          router.push('/app/groups');
          router.refresh();
        } else toast.error("Couldn't delete it. Try again.");
      }}
    >
      Delete
    </Button>
  );
}
