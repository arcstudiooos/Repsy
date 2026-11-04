import type { Metadata } from 'next';
import { listAssessments, TRAINER_ROLES } from '@kinetic/core';
import { GUIDE_LABEL } from '@/components/assessments/GuideOverlay';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { withServerTenant } from '@/server/serverActor';
import { ArchiveAssessment, AssessmentForm } from './AssessmentForm';

export const metadata: Metadata = { title: 'Assessments | Repsy' };

/** PRD E5: posture and mobility photo assessments, asked for from a client's Progress tab. */
export default async function AssessmentsPage() {
  const { items, canEdit } = await withServerTenant(async (tx, actor) => ({
    items: await listAssessments(tx, actor),
    canEdit: (TRAINER_ROLES as readonly string[]).includes(actor.role),
  }));
  return (
    <>
      <h1 className="mb-2 text-2xl font-semibold md:text-3xl">Assessments</h1>
      <p className="mb-6 text-secondary">
        Ask a client for one from their Progress tab. They are asked again every few weeks, and you
        see their first and latest photos side by side.
      </p>
      <div className="flex flex-col gap-6">
        {canEdit && (
          <Card>
            <CardHeader>
              <CardTitle as="h2">New assessment</CardTitle>
            </CardHeader>
            <CardContent>
              <AssessmentForm />
            </CardContent>
          </Card>
        )}
        {items.length === 0 ? (
          <p className="text-secondary">No assessments yet.</p>
        ) : (
          <ul aria-label="Assessments" className="flex flex-col gap-3">
            {items.map((a) => (
              <li key={a.id} className="rounded-card bg-surface p-4 shadow-card">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold break-words">{a.title}</p>
                    <p className="text-sm text-secondary">
                      {GUIDE_LABEL[a.guide]} ·{' '}
                      {a.everyWeeks === 0 ? 'once' : `every ${a.everyWeeks} weeks`} · {a.assigned}{' '}
                      {a.assigned === 1 ? 'client' : 'clients'}
                    </p>
                  </div>
                  {canEdit && <ArchiveAssessment id={a.id} title={a.title} />}
                </div>
                {canEdit && (
                  <details className="mt-2">
                    <summary className="min-h-11 cursor-pointer py-2 text-accent">
                      Edit {a.title}
                    </summary>
                    <AssessmentForm initial={a} />
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
