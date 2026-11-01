'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import type { Role, TeamInviteView, TeamMemberView } from '@kinetic/core';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { call } from '@/lib/checkin-api';

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  coach: 'Coach',
  assistant: 'Assistant',
};
const ROLE_HELP =
  'Admins run the workspace with you. Coaches build programs and look after their clients. Assistants message and review but don’t edit programs, clients or settings.';
const SELECT =
  'block min-h-11 rounded-control border border-input-border bg-surface px-3 text-base text-ink';

/** PRD A10: the workspace's team. Owners and admins invite and manage; everyone else reads. */
export function TeamManager({
  me,
  myRole,
  members,
  invites,
}: {
  me: string;
  myRole: Role;
  members: TeamMemberView[];
  invites: TeamInviteView[];
}) {
  const router = useRouter();
  const id = useId();
  const manager = myRole === 'owner' || myRole === 'admin';
  const grantable = myRole === 'owner' ? ['admin', 'coach', 'assistant'] : ['coach', 'assistant'];
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function invite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setErrors({});
    const res = await call('POST', '/api/v1/team/invites', {
      email: String(data.get('email') ?? ''),
      role: String(data.get('role') ?? 'coach'),
    });
    setBusy(false);
    if (!res.ok) {
      setErrors({
        email: res.fieldErrors?.email?.[0] ?? '',
        form: res.fieldErrors ? '' : res.message,
      });
      return;
    }
    form.reset();
    toast.success('Invite sent');
    router.refresh();
  }
  async function send(method: 'PUT' | 'DELETE', path: string, body?: unknown, ok?: string) {
    const res = await (method === 'PUT'
      ? call(method, path, body)
      : fetch(path, { method, credentials: 'same-origin' }).then(async (r) => ({
          ok: r.ok,
          message:
            ((await r.json().catch(() => null)) as { error?: { message?: string } } | null)?.error
              ?.message ?? '',
        })));
    if (res.ok) {
      if (ok) toast.success(ok);
      router.refresh();
    } else toast.error(('message' in res && res.message) || "That didn't work. Try again.");
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle as="h2">People</CardTitle>
          <CardDescription>{ROLE_HELP}</CardDescription>
        </CardHeader>
        <CardContent>
          <ul aria-label="Team" className="flex flex-col divide-y divide-divider">
            {members.map((m) => {
              const editable =
                manager && m.role !== 'owner' && m.userId !== me && grantable.includes(m.role);
              return (
                <li
                  key={m.membershipId}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <div className="min-w-0">
                    <p className="font-medium">
                      {m.name}
                      {m.userId === me && <span className="text-secondary"> (you)</span>}
                    </p>
                    <p className="text-sm break-all text-secondary">{m.email}</p>
                  </div>
                  {editable ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <label htmlFor={`${id}-${m.membershipId}`} className="sr-only">
                        Role for {m.name}
                      </label>
                      <select
                        id={`${id}-${m.membershipId}`}
                        value={m.role}
                        onChange={(e) =>
                          void send(
                            'PUT',
                            `/api/v1/team/members/${m.membershipId}`,
                            { role: e.target.value },
                            'Role changed',
                          )
                        }
                        className={SELECT}
                      >
                        {grantable.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </option>
                        ))}
                      </select>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove ${m.name} from the team`}
                        onClick={() =>
                          void send(
                            'DELETE',
                            `/api/v1/team/members/${m.membershipId}`,
                            undefined,
                            'Removed from the team',
                          )
                        }
                      >
                        Remove
                      </Button>
                    </div>
                  ) : (
                    <span className="text-sm text-secondary">{ROLE_LABEL[m.role] ?? m.role}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
      {manager && (
        <Card>
          <CardHeader>
            <CardTitle as="h2">Invite someone</CardTitle>
            <CardDescription>They get an email link that works for 7 days.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <form onSubmit={invite} noValidate className="flex flex-wrap items-end gap-3">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <label htmlFor={`${id}-email`} className="text-sm font-medium">
                  Email
                </label>
                <Input
                  id={`${id}-email`}
                  name="email"
                  type="email"
                  aria-invalid={errors.email ? true : undefined}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor={`${id}-role`} className="text-sm font-medium">
                  Role
                </label>
                <select id={`${id}-role`} name="role" defaultValue="coach" className={SELECT}>
                  {grantable.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" disabled={busy}>
                {busy ? 'Sending…' : 'Send invite'}
              </Button>
            </form>
            {(errors.email || errors.form) && (
              <p role="alert" className="text-sm text-danger">
                {errors.email || errors.form}
              </p>
            )}
            {invites.length > 0 && (
              <ul aria-label="Open invites" className="flex flex-col divide-y divide-divider">
                {invites.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="break-all">
                      {i.email} · {ROLE_LABEL[i.role]}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Cancel the invite for ${i.email}`}
                      onClick={() =>
                        void send(
                          'DELETE',
                          `/api/v1/team/invites/${i.id}`,
                          undefined,
                          'Invite cancelled',
                        )
                      }
                    >
                      Cancel
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
