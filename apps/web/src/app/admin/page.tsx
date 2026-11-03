import type { Metadata } from 'next';
import Link from 'next/link';
import { LapseControl } from './LapseControl';
import { notFound } from 'next/navigation';
import {
  listDeletionRequests,
  listMyGrants,
  listPilotCodes,
  lookupAccount,
  DomainError,
} from '@kinetic/core';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { withPlatformAdmin } from '@/server/platformAdmin';
import { getServerSession } from '@/server/serverActor';
import {
  DeletionActions,
  GrantForm,
  NoticeForm,
  PilotCodeCreator,
  ResolveNotice,
  RevokeGrant,
} from './AdminActions';
import { readNotices } from '@kinetic/core';

// May block on request data (session, params); opts out of Next instant-navigation validation, see HANDOFF.
export const instant = false;

export const metadata: Metadata = { title: 'Admin | Repsy' };

const when = (iso: string) => new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

/** Platform admin console (S5-3): pilot codes, account lookup, the deletion queue and support access. */
export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const email = first((await searchParams).email);
  const { user } = await getServerSession();
  // Authorize before system scope opens (the layout's gate renders in parallel, so it is not relied on here).
  if (!user?.isPlatformAdmin) notFound();
  const notices = await readNotices();
  const data = await withPlatformAdmin(user, async (tx, admin) => {
    let account = null;
    let lookupError: string | null = null;
    if (email) {
      try {
        account = await lookupAccount(tx, admin, email);
        if (!account) lookupError = 'No account with that email.';
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        lookupError = 'Enter an email.';
      }
    }
    return {
      codes: await listPilotCodes(tx, admin),
      deletions: await listDeletionRequests(tx, admin),
      grants: await listMyGrants(tx, admin),
      account,
      lookupError,
    };
  });

  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold md:text-3xl">Admin</h1>
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Status notices</CardTitle>
            <CardDescription>
              Shown as a banner in the app and on the public status page until resolved.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {notices.open.map((n) => (
              <div key={n.id} className="flex flex-col gap-2 rounded-control bg-canvas p-3">
                <p className="font-medium">
                  {n.severity}: {n.message}
                </p>
                <ResolveNotice id={n.id} message={n.message} />
              </div>
            ))}
            <NoticeForm />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Pilot codes</CardTitle>
            <CardDescription>Codes are stored hashed; a new one is shown once.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <PilotCodeCreator />
            <p className="text-sm text-secondary">
              {data.codes.filter((c) => !c.used).length} unused ·{' '}
              {data.codes.filter((c) => c.used).length} used
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Account lookup</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <form method="get" className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <label htmlFor="email" className="text-sm font-medium">
                  Email
                </label>
                <Input id="email" name="email" type="email" defaultValue={email ?? ''} />
              </div>
              <Button type="submit" variant="secondary">
                Look up
              </Button>
            </form>
            {data.lookupError && <p role="status">{data.lookupError}</p>}
            {data.account && (
              <div aria-label="Account" className="text-sm">
                <p className="font-medium">
                  {data.account.name} · {data.account.email}
                  {data.account.emailVerified ? '' : ' (not verified)'}
                </p>
                <ul className="mt-2 flex flex-col gap-1">
                  {data.account.memberships.map((m) => (
                    <li key={`${m.organizationId}:${m.role}`}>
                      {m.organizationName}: {m.role} ({m.status})
                      {m.role === 'owner' && (
                        <LapseControl orgId={m.organizationId} name={m.organizationName} />
                      )}
                      {m.clientId && (
                        <>
                          {' '}
                          · client id <code className="font-mono">{m.clientId}</code>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Deletion requests</CardTitle>
            <CardDescription>
              Verify a request to have the worker delete the client&apos;s data in that workspace. A
              legal hold stops it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.deletions.length === 0 ? (
              <p className="text-secondary">No deletion requests.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-divider">
                {data.deletions.map((d) => (
                  <li key={d.id} className="flex flex-col gap-2 py-3">
                    <p className="text-sm">
                      <span className="font-medium">{d.status}</span>
                      {d.legalHold && ' · legal hold'} · {d.organizationName} · client{' '}
                      <code className="font-mono">{d.clientId}</code> · by{' '}
                      {d.requestedByClient ? 'the client' : 'the owner'} · {when(d.createdAt)}
                    </p>
                    {d.status === 'verified' && d.failedAttempts > 0 && (
                      <p className="text-sm text-danger">
                        Erasure failed {d.failedAttempts}{' '}
                        {d.failedAttempts === 1 ? 'time' : 'times'} ({d.lastErrorCode ?? 'unknown'}
                        ). It is retried every minute; check the worker logs.
                      </p>
                    )}
                    <DeletionActions id={d.id} status={d.status} legalHold={d.legalHold} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Support access</CardTitle>
            <CardDescription>
              Reading a client&apos;s data needs a grant with a reason. It lasts 24 hours and every
              read is audited.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <GrantForm />
            {data.grants.length > 0 && (
              <ul className="flex flex-col gap-2 text-sm">
                {data.grants.map((g) => (
                  <li key={g.id} className="flex flex-wrap items-center gap-2">
                    <code className="font-mono">{g.clientId}</code>
                    {g.active ? (
                      <>
                        · until {when(g.expiresAt)} ·{' '}
                        <Link
                          href={`/admin/support/${g.clientId}`}
                          className="text-accent underline"
                        >
                          Open
                        </Link>
                        <RevokeGrant id={g.id} />
                      </>
                    ) : (
                      ' · ended'
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
