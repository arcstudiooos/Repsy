import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DomainError, getProgram, getSettings, listProgramVersions } from '@kinetic/core';
import { EmptyState } from '@/components/states/EmptyState';
import { withServerTenant } from '@/server/serverActor';

export const metadata: Metadata = { title: 'Version history | Repsy' };

/** A commit time as an org-local date and time, e.g. "30 Oct 2026, 14:05". */
function formatSavedAt(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(new Date(iso));
}

export default async function ProgramHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let loaded;
  try {
    loaded = await withServerTenant(async (tx, actor) => {
      const program = await getProgram(tx, actor, id);
      const versions = await listProgramVersions(tx, actor, id);
      const settings = await getSettings(tx, actor);
      return { program, versions, timeZone: settings.org?.timezone ?? 'UTC' };
    });
  } catch (error) {
    if (error instanceof DomainError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
  const { program, versions, timeZone } = loaded;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href={`/app/programs/${program.id}/edit`}
          className="text-sm font-medium text-accent underline"
        >
          Back to editor
        </Link>
        <h1 className="text-h1 font-semibold md:text-display">Version history</h1>
        <p className="text-sm break-words text-secondary">{program.title}</p>
      </div>

      {versions.length === 0 ? (
        <EmptyState
          title="No saved versions yet"
          body="Each time you save changes, a new version appears here."
        />
      ) : (
        <div className="overflow-x-auto rounded-card bg-surface shadow-card">
          <table className="w-full text-left text-base">
            <caption className="sr-only">Saved versions of {program.title}, newest first</caption>
            <thead className="border-b border-divider text-sm text-secondary">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  Version
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Saved by
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Saved at
                </th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.versionNo} className="border-b border-divider last:border-0">
                  <td className="px-4 py-2 whitespace-nowrap">
                    <Link
                      href={`/app/programs/${program.id}/versions/${v.versionNo}`}
                      className="inline-flex min-h-11 items-center font-medium underline underline-offset-2"
                    >
                      Version {v.versionNo}
                    </Link>
                  </td>
                  <td className="px-4 py-2 [overflow-wrap:anywhere]">{v.committedBy.name}</td>
                  <td className="px-4 py-2">
                    <time dateTime={v.committedAt}>{formatSavedAt(v.committedAt, timeZone)}</time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
