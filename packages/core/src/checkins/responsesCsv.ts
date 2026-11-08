import type { TenantTx } from '@repsy/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { toCsv, type CsvValue } from '../exports/csv';
import { fromDbDate } from '../sessions/read';
import { isUuid } from '../uuid';
import { readQuestions } from './questions';

/**
 * One client's sent check-ins as a CSV for the coach (PRD F12): one row per check-in, one column per question (by
 * label, in first-asked order, so a later template edit adds columns instead of shifting them). The whole workspace
 * is in the owner's data export. Formula-like text is neutralised by `toCsv`.
 */
export async function checkinResponsesCsv(
  tx: TenantTx,
  actor: ActorContext,
  clientId: string,
): Promise<{ filename: string; csv: string }> {
  assertCan(actor, 'client:read');
  if (!isUuid(clientId)) throw new DomainError('NOT_FOUND', 'Not found.');
  const client = await tx.client.findFirst({
    where: { id: clientId },
    select: { id: true, name: true },
  });
  if (!client) throw new DomainError('NOT_FOUND', 'Not found.');
  const rows = await tx.checkin.findMany({
    where: { clientId: client.id, submittedAt: { not: null } },
    orderBy: { periodLocalDate: 'asc' },
    select: {
      periodLocalDate: true,
      submittedAt: true,
      reviewedAt: true,
      questionsJson: true,
      answersJson: true,
    },
  });
  const labels: string[] = [];
  const parsed = rows.map((r) => {
    const questions = readQuestions(r.questionsJson);
    const answers = (r.answersJson ?? {}) as Record<string, CsvValue | string[]>;
    const byLabel = new Map<string, CsvValue>();
    for (const q of questions) {
      if (!labels.includes(q.label)) labels.push(q.label);
      const v = answers[q.id];
      // PRD F3: several choices in one cell; metric answers are canonical (kg, cm).
      byLabel.set(q.label, Array.isArray(v) ? v.join('; ') : (v ?? null));
    }
    return { r, byLabel };
  });
  const csv = toCsv(
    ['week_of', 'sent_at', 'reviewed_at', ...labels],
    parsed.map(({ r, byLabel }) => [
      fromDbDate(r.periodLocalDate),
      r.submittedAt?.toISOString(),
      r.reviewedAt?.toISOString() ?? null,
      ...labels.map((l) => byLabel.get(l) ?? null),
    ]),
  );
  const slug =
    client.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'client';
  return { filename: `check-ins-${slug}.csv`, csv };
}
