import type { Metadata } from 'next';
import Link from 'next/link';
import { listSequences, SEQUENCE_TEMPLATES } from '@kinetic/core';
import { EmptyState } from '@/components/states/EmptyState';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { withServerTenant } from '@/server/serverActor';

export const metadata: Metadata = { title: 'Automations | Repsy' };

const TRIGGER_TEXT: Record<string, string> = {
  manual: 'Started by hand',
  invite_accepted: 'When a client joins',
  intake_submitted: 'When a client sends their intake',
  checkin_submitted: 'When a client sends a check-in',
  program_finished: 'When a client finishes a program',
  tag_added: 'When a client gets a tag',
  stage_changed: 'When a client changes stage',
};

/** PRD J1, J9: the workspace's automations, and starters to copy. */
export default async function AutomationsPage() {
  const sequences = await withServerTenant((tx, actor) => listSequences(tx, actor));
  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold md:text-3xl">Automations</h1>
        <Link href="/app/automations/new" className={buttonVariants()}>
          New automation
        </Link>
      </div>
      <div className="flex flex-col gap-6">
        {sequences.length === 0 ? (
          <EmptyState
            title="No automations yet"
            body="Send messages, forms and habits on a schedule after a client joins, or whenever you start one."
          />
        ) : (
          <ul aria-label="Automations" className="flex flex-col gap-3">
            {sequences.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/app/automations/${s.id}`}
                  className="flex min-h-11 flex-col gap-1 rounded-card bg-surface p-4 shadow-card hover:bg-canvas"
                >
                  <span className="font-semibold">
                    {s.name}
                    {!s.active && (
                      <span className="ml-2 text-sm font-normal text-secondary">(off)</span>
                    )}
                  </span>
                  <span className="text-sm text-secondary">
                    {TRIGGER_TEXT[s.trigger]} · {s.steps.length}{' '}
                    {s.steps.length === 1 ? 'step' : 'steps'} · {s.activeRuns} running
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Card>
          <CardHeader>
            <CardTitle as="h2">Start from a template</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2">
              {SEQUENCE_TEMPLATES.map((t) => (
                <li key={t.key}>
                  <Link
                    href={`/app/automations/new?template=${t.key}`}
                    className="text-accent underline"
                  >
                    {t.name}
                  </Link>{' '}
                  <span className="text-sm text-secondary">
                    · {TRIGGER_TEXT[t.trigger]} · {t.steps.length} steps
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
