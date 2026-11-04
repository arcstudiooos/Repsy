import type { Metadata } from 'next';
import Link from 'next/link';
import {
  clientCompliance,
  DomainError,
  listClients,
  listCheckinTemplates,
  listTags,
  tagsForClients,
  type ClientCompliance,
  type TagView,
  type ClientStatus,
  LIFECYCLE_STAGES,
  parseScope,
  scopeCoachIds,
  TRAINER_ROLES,
} from '@kinetic/core';
import { Button, buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/states/EmptyState';
import { ErrorState } from '@/components/states/ErrorState';
import { loadAllTemplates } from '@/server/selectOptions';
import { withServerTenant } from '@/server/serverActor';
import { ClientsTable } from './ClientsTable';
import { JoinLinkDialog } from './JoinLinkDialog';
import { NewClientDialog } from './NewClientDialog';

export const metadata: Metadata = { title: 'Clients | Repsy' };

const STATUSES: ClientStatus[] = ['invited', 'active', 'paused', 'archived'];

const first = (v: string | string[] | undefined): string | undefined =>
  (Array.isArray(v) ? v[0] : v) || undefined;

function ImportLink() {
  return (
    <Button asChild variant="secondary">
      <Link href="/app/clients/import">Import from CSV</Link>
    </Button>
  );
}

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = first(sp.q)?.trim().slice(0, 100) || undefined;
  const statusParam = first(sp.status);
  const status = STATUSES.find((s) => s === statusParam);
  const cursor = first(sp.cursor);
  const tagParam = first(sp.tag);
  const stage = LIFECYCLE_STAGES.find((s) => s === first(sp.stage));

  let result: Awaited<ReturnType<typeof listClients>>;
  let compliance: Record<string, ClientCompliance>;
  let tags: TagView[];
  let clientTags: Record<string, TagView[]>;
  let tagId: string | undefined;
  let templates: { id: string; title: string; daysPerWeek: number }[];
  let intakeForms: { id: string; title: string }[];
  let scope: 'mine' | 'all';
  let coachNames: Record<string, string>;
  try {
    ({ result, compliance, tags, clientTags, tagId, templates, intakeForms, scope, coachNames } =
      await withServerTenant(async (tx, actor) => {
        const all = await listTags(tx, actor);
        const tagId = all.find((t) => t.id === tagParam)?.id;
        // PRD A12: coaches see their own clients by default, owners and admins everyone.
        const trainers = await tx.membership.findMany({
          where: { status: 'active', role: { in: [...TRAINER_ROLES] } },
          select: { userId: true, user: { select: { name: true } } },
        });
        const team = trainers.length > 1;
        const scope = team ? parseScope(actor.role, first(sp.scope)) : 'all';
        const coachUserIds = (await scopeCoachIds(tx, actor, scope)) ?? undefined;
        const list = await listClients(tx, actor, {
          q,
          status,
          cursor,
          tagId,
          stage,
          coachUserIds,
        });
        const byClient = await clientCompliance(
          tx,
          actor,
          list.items.map((c) => c.id),
        );
        const ids = list.items.map((c) => c.id);
        return {
          scope,
          coachNames: team ? Object.fromEntries(trainers.map((t) => [t.userId, t.user.name])) : {},
          result: list,
          compliance: Object.fromEntries(byClient),
          tags: all.map(({ id, name, color }) => ({ id, name, color })),
          clientTags: Object.fromEntries(await tagsForClients(tx, actor, ids)),
          tagId,
          intakeForms: (await listCheckinTemplates(tx, actor))
            .filter((t) => t.kind === 'intake')
            .map((t) => ({ id: t.id, title: t.title })),
          // PRD B5: saved templates for bulk assign.
          templates: (await loadAllTemplates(tx, actor)).items.flatMap((p) =>
            p.versionNo !== null && p.daysPerWeek
              ? [{ id: p.id, title: p.title, daysPerWeek: p.daysPerWeek }]
              : [],
          ),
        };
      }));
  } catch (error) {
    // A malformed cursor in the URL is the only user-reachable validation failure.
    if (error instanceof DomainError && error.code === 'VALIDATION') {
      return (
        <>
          <h1 className="mb-6 text-2xl font-semibold md:text-3xl">Clients</h1>
          <ErrorState message="That page link is no longer valid. Go back to the first page." />
        </>
      );
    }
    throw error;
  }

  const filtered =
    q !== undefined ||
    status !== undefined ||
    tagId !== undefined ||
    stage !== undefined ||
    scope === 'mine';
  const isEmptyRoster = result.items.length === 0 && !filtered && cursor === undefined;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold md:text-3xl">Clients</h1>
        {!isEmptyRoster && (
          <div className="flex flex-wrap gap-3">
            <ImportLink />
            <JoinLinkDialog />
            <NewClientDialog intakeForms={intakeForms} />
          </div>
        )}
      </div>
      {Object.keys(coachNames).length > 1 && (
        <nav aria-label="Whose clients" className="mb-4 flex gap-2">
          {(
            [
              ['mine', 'My clients'],
              ['all', 'All clients'],
            ] as const
          ).map(([value, label]) => (
            <Link
              key={value}
              href={`/app/clients?scope=${value}`}
              aria-current={scope === value ? 'page' : undefined}
              className={buttonVariants({
                variant: scope === value ? 'default' : 'secondary',
                size: 'sm',
              })}
            >
              {label}
            </Link>
          ))}
        </nav>
      )}
      {isEmptyRoster ? (
        <EmptyState
          title="Add your first client"
          body="Invite a client by email. They will get a link to set up their account. Moving from another app? Import your roster from a CSV file."
          action={
            <div className="flex flex-wrap justify-center gap-3">
              <NewClientDialog intakeForms={intakeForms} />
              <JoinLinkDialog />
              <ImportLink />
            </div>
          }
        />
      ) : (
        <ClientsTable
          items={result.items}
          compliance={compliance}
          tags={tags}
          clientTags={clientTags}
          tag={tagId ?? ''}
          nextCursor={result.nextCursor}
          q={q ?? ''}
          status={status ?? ''}
          coachNames={coachNames}
          stage={stage ?? ''}
          hasCursor={cursor !== undefined}
          templates={templates}
        />
      )}
    </>
  );
}
