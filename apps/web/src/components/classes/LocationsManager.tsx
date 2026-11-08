'use client';

import type { LocationStaffView, LocationView } from '@repsy/core';
import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { EmptyState } from '@/components/states/EmptyState';
import { createLocation, setStaffLocation, updateLocation } from '@/lib/classes-api';

const selectClass =
  'block min-h-11 rounded-control border border-input-border bg-surface px-3 text-base text-ink';

/** PRD A15: a workspace's sites, and which site each team member works at. Owners and admins. */
export function LocationsManager({
  locations,
  archived,
  staff,
}: {
  locations: LocationView[];
  archived: LocationView[];
  staff: LocationStaffView[];
}) {
  const router = useRouter();
  const id = useId();
  const [busy, setBusy] = useState(false);

  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    setBusy(true);
    const res = await createLocation({
      name: String(form.get('name') ?? ''),
      address: String(form.get('address') ?? '') || null,
    });
    setBusy(false);
    if (!res.ok) return toast.error(res.message);
    formEl.reset();
    toast.success('Location added.');
    router.refresh();
  }

  async function rename(loc: LocationView) {
    const name = window.prompt('Location name', loc.name);
    if (!name || name === loc.name) return;
    const res = await updateLocation(loc.id, { name, address: loc.address });
    if (!res.ok) return toast.error(res.message);
    router.refresh();
  }

  async function archive(loc: LocationView, value: boolean) {
    const res = await updateLocation(loc.id, { archived: value });
    if (!res.ok) return toast.error(res.message);
    toast.success(value ? `${loc.name} archived.` : `${loc.name} restored.`);
    router.refresh();
  }

  async function assign(userId: string, locationId: string) {
    const res = await setStaffLocation(userId, locationId || null);
    if (!res.ok) return toast.error(res.message);
    toast.success('Saved.');
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <form onSubmit={add} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex flex-1 flex-col gap-1 text-sm" htmlFor={`${id}-name`}>
            Name
            <Input id={`${id}-name`} name="name" required maxLength={80} />
          </label>
          <label className="flex flex-[2] flex-col gap-1 text-sm" htmlFor={`${id}-addr`}>
            Address (optional)
            <Input id={`${id}-addr`} name="address" maxLength={300} />
          </label>
          <Button type="submit" disabled={busy}>
            Add location
          </Button>
        </form>
      </Card>

      {locations.length === 0 ? (
        <EmptyState
          title="No locations yet"
          body="Add each site you coach from. Then tie clients, team members and classes to a site."
        />
      ) : (
        <section aria-labelledby={`${id}-list`}>
          <h2 id={`${id}-list`} className="mb-3 text-h2 font-semibold">
            Locations
          </h2>
          <ul className="flex flex-col gap-3">
            {locations.map((l) => (
              <li key={l.id}>
                <Card className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold break-words">{l.name}</p>
                    {l.address && <p className="text-sm break-words text-secondary">{l.address}</p>}
                    <p className="text-sm text-secondary">
                      {l.clientCount} {l.clientCount === 1 ? 'client' : 'clients'} · {l.staffCount}{' '}
                      team
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => rename(l)}>
                      Rename
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => archive(l, true)}>
                      Archive
                    </Button>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}

      {locations.length > 0 && staff.length > 0 && (
        <section aria-labelledby={`${id}-team`}>
          <h2 id={`${id}-team`} className="mb-3 text-h2 font-semibold">
            Team
          </h2>
          <Card>
            <ul className="flex flex-col gap-3">
              {staff.map((s) => (
                <li key={s.userId} className="flex flex-wrap items-center justify-between gap-2">
                  <label htmlFor={`${id}-${s.userId}`} className="min-w-0 break-words">
                    {s.name} <span className="text-sm text-secondary">({s.role})</span>
                  </label>
                  <select
                    id={`${id}-${s.userId}`}
                    defaultValue={s.locationId ?? ''}
                    onChange={(e) => assign(s.userId, e.target.value)}
                    className={selectClass}
                  >
                    <option value="">Every location</option>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      {archived.length > 0 && (
        <section aria-labelledby={`${id}-arch`}>
          <h2 id={`${id}-arch`} className="mb-3 text-h2 font-semibold">
            Archived
          </h2>
          <ul className="flex flex-col gap-2">
            {archived.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="break-words text-secondary">{l.name}</span>
                <Button size="sm" variant="ghost" onClick={() => archive(l, false)}>
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
