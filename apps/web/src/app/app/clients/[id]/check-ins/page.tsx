import type { Metadata } from 'next';
import Link from 'next/link';
import {
  checkinStreak,
  checkinWeekSummary,
  getSettings,
  listCheckinTemplates,
  listCheckins,
  metricsAsOf,
} from '@repsy/core';
import { CheckinAnswersList } from '@/components/checkins/CheckinAnswersList';
import { EmptyState } from '@/components/states/EmptyState';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { withServerTenant } from '@/server/serverActor';
import { formatDate } from '../../StatusBadge';
import { loadClient } from '../data';
import { CheckinSchedule } from './CheckinSchedule';
import { SendForm } from './SendForm';
import { CheckinCompare, type CompareCheckin } from '@/components/checkins/CheckinCompare';
import { WeekSummary } from '@/components/checkins/WeekSummary';
import { MarkReviewedButton } from './MarkReviewedButton';

export const metadata: Metadata = { title: 'Check-ins | Repsy' };

const STATUS = {
  open: 'Waiting for the client',
  overdue: 'Past due',
  submitted: 'Submitted',
} as const;
/** Activity is shown beside the most recent check-ins only. */
const WITH_ACTIVITY = 12;

export default async function ClientCheckinsPage({ params }: { params: Promise<{ id: string }> }) {
  const client = await loadClient((await params).id);
  const { items, streak, units, metricsAt, templates } = await withServerTenant(
    async (tx, actor) => {
      const checkins = await listCheckins(tx, actor, { clientId: client.id });
      const out = [];
      for (const [i, c] of checkins.entries()) {
        out.push({
          checkin: c,
          activity:
            i < WITH_ACTIVITY
              ? await checkinWeekSummary(tx, actor, client.id, c.periodLocalDate)
              : null,
        });
      }
      return {
        items: out,
        streak: await checkinStreak(tx, actor, { clientId: client.id }),
        templates: await listCheckinTemplates(tx, actor),
        units: (await getSettings(tx, actor)).profile?.units ?? client.preferredUnits,
        metricsAt: await metricsAsOf(
          tx,
          actor,
          client.id,
          checkins.filter((c) => c.answers).map((c) => c.periodLocalDate),
        ),
      };
    },
  );
  // Sent check-ins, newest first, for comparing with any earlier one (PRD F6).
  const sent: CompareCheckin[] = items
    .filter(({ checkin }) => checkin.answers)
    .map(({ checkin }) => ({
      id: checkin.id,
      periodLocalDate: checkin.periodLocalDate,
      questions: checkin.questions,
      answers: checkin.answers!,
    }));
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Weekly check-in</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <CheckinSchedule
            clientId={client.id}
            weekday={client.checkinWeekday}
            everyWeeks={client.checkinEveryWeeks}
            templateId={client.checkinTemplateId}
            templates={templates
              .filter((t) => t.kind === 'checkin')
              .map((t) => ({ id: t.id, title: t.title, isDefault: t.isDefault }))}
            disabled={client.status === 'archived'}
          />
          {client.status !== 'archived' && (
            <SendForm
              clientId={client.id}
              forms={templates
                .filter((t) => t.kind !== 'checkin')
                .map((t) => ({ id: t.id, title: t.title }))}
            />
          )}
          {items.some(({ checkin }) => checkin.submittedAt) && (
            <a
              href={`/api/v1/clients/${client.id}/checkins.csv`}
              className="inline-flex min-h-11 items-center self-start text-accent underline underline-offset-4"
              download
            >
              Download answers (CSV)
            </a>
          )}
          {items.length > 0 && (
            <p>
              On-time streak:{' '}
              <span className="font-semibold">
                {streak} {streak === 1 ? 'check-in' : 'check-ins'}
              </span>
            </p>
          )}
          <Link
            href="/app/check-ins"
            className="self-start text-accent underline underline-offset-4"
          >
            Edit check-in questions
          </Link>
        </CardContent>
      </Card>

      {items.length === 0 ? (
        <EmptyState title="No check-ins yet" body="Check-ins will appear here once one is sent." />
      ) : (
        <ol className="flex flex-col gap-4">
          {items.map(({ checkin: c, activity }) => (
            <li key={c.id}>
              <Card>
                <CardHeader>
                  <CardTitle as="h3">
                    {c.kind === 'checkin'
                      ? `Week of ${formatDate(c.periodLocalDate)}`
                      : `${c.title} · sent ${formatDate(c.periodLocalDate)}`}
                  </CardTitle>
                  <CardDescription>
                    {c.title} · {STATUS[c.status]}
                    {c.reviewedAt && ` · Reviewed ${formatDate(c.reviewedAt.slice(0, 10))}`}
                  </CardDescription>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    {c.status === 'submitted' && !c.reviewedAt && (
                      <MarkReviewedButton id={c.id} label={formatDate(c.periodLocalDate)} />
                    )}
                    {c.status === 'submitted' && (
                      <Link
                        href={`/app/clients/${client.id}/messages?re=checkin:${c.id}`}
                        className="inline-flex min-h-11 items-center text-sm text-accent underline underline-offset-4"
                      >
                        Reply about the week of {formatDate(c.periodLocalDate)}
                      </Link>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="grid gap-6 md:grid-cols-[2fr_1fr]">
                  {c.answers ? (
                    <div className="flex flex-col gap-4">
                      <CheckinAnswersList
                        questions={c.questions}
                        answers={c.answers}
                        units={units}
                        previous={
                          sent.find((x) => x.periodLocalDate < c.periodLocalDate)?.answers ?? null
                        }
                        history={Object.fromEntries(
                          c.questions
                            .filter((q) => q.type === 'scale_1_5')
                            .map((q) => [
                              q.id,
                              sent
                                .filter((x) => x.periodLocalDate <= c.periodLocalDate)
                                .slice(0, 8)
                                .reverse()
                                .map((x) =>
                                  typeof x.answers[q.id] === 'number'
                                    ? (x.answers[q.id] as number)
                                    : null,
                                ),
                            ]),
                        )}
                      />
                      <CheckinCompare
                        current={sent.find((x) => x.id === c.id)!}
                        earlier={sent.filter((x) => x.periodLocalDate < c.periodLocalDate)}
                        metricsAt={metricsAt}
                        units={units}
                      />
                    </div>
                  ) : (
                    <p className="text-secondary">No answers yet.</p>
                  )}
                  {activity && (
                    <WeekSummary summary={activity} units={units} heading="Week before" />
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
