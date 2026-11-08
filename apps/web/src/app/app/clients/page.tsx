import type { Metadata } from 'next';
import Link from 'next/link';
import {
  clientCompliance,
  getClientAdherence,
  listThreads,
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
} from '@repsy/core';
import { LayoutGrid, List, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ChipRow, FilterChip } from '@/components/ui/filter-chip';
import { PageHeader } from '@/components/ui/page-header';
import { SegmentedLinks } from '@/components/ui/segmented';
import { EmptyState } from '@/components/states/EmptyState';
import { ErrorState } from '@/components/states/ErrorState';
import { loadAllTemplates } from '@/server/selectOptions';
import { withServerTenant } from '@/server/serverActor';
import { ClientsTable, type ClientExtras } from './ClientsTable';
import { JoinLinkDialog } from './JoinLinkDialog';
import { NewClientDialog } from './NewClientDialog';

export const metadata: Metadata = { title: 'Clients | Repsy' };

const STATUSES: ClientStatus[] = ['active', 'invited', 'paused', 'archived'];
const STATUS_LABEL: Record<ClientStatus, string> = {
  active: 'Active',
  invited: 'Invited',
  paused: 'Paused',
  archived: 'Archived',
};

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
  let extras: Record<string, ClientExtras>;
  let statusCounts: Partial<Record<ClientStatus, number>>;
  try {
    ({
      result,
      compliance,
      tags,
      clientTags,
      tagId,
      templates,
      intakeForms,
      scope,
      coachNames,
      extras,
      statusCounts,
    } = await withServerTenant(async (tx, actor) => {
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
      // The extra columns: current program, last / next workout and the week, unread messages.
      const adh = await getClientAdherence(tx, actor, ids, { days: 28 });
      const assignments = await tx.programAssignment.findMany({
        where: { clientId: { in: ids }, status: 'active' },
        select: { clientId: true, program: { select: { title: true } } },
      });
      const program = new Map(assignments.map((a) => [a.clientId, a.program.title]));
      const unread = new Map((await listThreads(tx, actor)).map((t) => [t.clientId, t.unread]));
      const extras: Record<string, ClientExtras> = {};
      for (const id of ids) {
        const row = adh.get(id);
        extras[id] = {
          program: program.get(id) ?? null,
          lastWorkout: row?.lastWorkout ?? null,
          nextWorkout: row?.nextWorkout ?? null,
          adherencePct: row?.adherencePct ?? null,
          week: row?.week ?? [],
          unread: unread.get(id) ?? 0,
        };
      }
      const counts = await tx.client.groupBy({
        by: ['status'],
        where: coachUserIds ? { coachUserId: { in: coachUserIds } } : {},
        _count: { _all: true },
      });
      const statusCounts = Object.fromEntries(counts.map((c) => [c.status, c._count._all]));
      return {
        extras,
        statusCounts,
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
          <PageHeader title="Clients" />
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

  const view = first(sp.view) === 'grid' ? 'grid' : 'list';
  const totalClients = Object.values(statusCounts).reduce((a, b) => a + (b ?? 0), 0);
  const chipHref = (st?: ClientStatus) => {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (st) p.set('status', st);
    if (tagId) p.set('tag', tagId);
    if (stage) p.set('stage', stage);
    if (view === 'grid') p.set('view', 'grid');
    const qs = p.toString();
    return qs ? `/app/clients?${qs}` : '/app/clients';
  };
  const viewHref = (v: 'list' | 'grid') => {
    const p = new URLSearchParams();
    for (const [k, val] of Object.entries(sp))
      if (typeof val === 'string' && k !== 'view' && k !== 'cursor') p.set(k, val);
    if (v === 'grid') p.set('view', 'grid');
    const qs = p.toString();
    return qs ? `/app/clients?${qs}` : '/app/clients';
  };

  return (
    <>
      <PageHeader
        title="Clients"
        subtitle={`${totalClients} ${totalClients === 1 ? 'client' : 'clients'}${scope === 'mine' ? ' you coach' : ''}. Search, filter, or select several to act on them at once.`}
        actions={
          !isEmptyRoster && (
            <>
              <ImportLink />
              <JoinLinkDialog />
              <NewClientDialog intakeForms={intakeForms} />
            </>
          )
        }
      />
      {Object.keys(coachNames).length > 1 && (
        <SegmentedLinks
          label="Whose clients"
          className="mb-4"
          options={(
            [
              ['mine', 'My clients'],
              ['all', 'All clients'],
            ] as const
          ).map(([value, label]) => ({
            href: `/app/clients?scope=${value}`,
            label,
            current: scope === value,
          }))}
        />
      )}
      {!isEmptyRoster && (
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <ChipRow label="Filter by status">
            <FilterChip href={chipHref()} active={status === undefined} count={totalClients}>
              All
            </FilterChip>
            {STATUSES.map((st) => (
              <FilterChip
                key={st}
                href={chipHref(st)}
                active={status === st}
                count={statusCounts[st] ?? 0}
              >
                {STATUS_LABEL[st]}
              </FilterChip>
            ))}
          </ChipRow>
          <SegmentedLinks
            label="View"
            options={[
              {
                href: viewHref('list'),
                label: (
                  <>
                    <List aria-hidden className="size-4" />
                    List
                  </>
                ),
                current: view === 'list',
              },
              {
                href: viewHref('grid'),
                label: (
                  <>
                    <LayoutGrid aria-hidden className="size-4" />
                    Grid
                  </>
                ),
                current: view === 'grid',
              },
            ]}
          />
        </div>
      )}
      {isEmptyRoster ? (
        <EmptyState
          icon={UserPlus}
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
          extras={extras}
          view={view}
        />
      )}
    </>
  );
}
