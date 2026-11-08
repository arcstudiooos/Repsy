import { withSystem, type PrismaClient, type SystemTx } from '@repsy/db';
import { DomainError } from '../errors';
import { isUuid } from '../uuid';
import { assertPlatformAdmin, type PlatformAdmin } from './admin';

/**
 * Platform notices (PRD M8, D-011 #7): an admin posts an incident or maintenance notice; it shows as a banner in the
 * app and on the public status page until resolved, then stays in the incident history with an optional post-mortem.
 * Platform-wide, so there is no organization audit trail; each row records who posted it.
 */
export const NOTICE_SEVERITIES = ['maintenance', 'degraded', 'outage'] as const;
export type NoticeSeverity = (typeof NOTICE_SEVERITIES)[number];

export interface NoticeView {
  id: string;
  severity: NoticeSeverity;
  message: string;
  createdAt: string;
  resolvedAt: string | null;
  postmortem: string | null;
}

/** PRD M9: the reliability targets the status page shows. */
export const RELIABILITY_TARGETS = [
  { label: 'Monthly availability', target: '99.9%' },
  { label: 'Workout logs accepted and then lost', target: 'Zero (a release gate)' },
  { label: 'Crash-free sessions', target: 'Above 99.8%' },
] as const;

const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });

const view = (r: {
  id: string;
  severity: string;
  message: string;
  createdAt: Date;
  resolvedAt: Date | null;
  postmortem: string | null;
}): NoticeView => ({
  id: r.id,
  severity: r.severity as NoticeSeverity,
  message: r.message,
  createdAt: r.createdAt.toISOString(),
  resolvedAt: r.resolvedAt?.toISOString() ?? null,
  postmortem: r.postmortem,
});

export async function postNotice(
  tx: SystemTx,
  admin: PlatformAdmin,
  input: { severity?: unknown; message?: unknown },
): Promise<NoticeView> {
  assertPlatformAdmin(admin);
  if (!(NOTICE_SEVERITIES as readonly unknown[]).includes(input.severity)) {
    throw invalid('severity', 'Pick maintenance, degraded or outage.');
  }
  const message = typeof input.message === 'string' ? input.message.trim() : '';
  if (message.length < 1 || message.length > 300) throw invalid('message', 'Use 1-300 characters.');
  const row = await tx.platformNotice.create({
    data: { severity: input.severity as string, message, createdBy: admin.userId },
  });
  return view(row);
}

/** Resolves a notice, optionally with a post-mortem (also addable later). */
export async function resolveNotice(
  tx: SystemTx,
  admin: PlatformAdmin,
  id: unknown,
  input: { postmortem?: unknown } = {},
  now: Date = new Date(),
): Promise<NoticeView> {
  assertPlatformAdmin(admin);
  if (!isUuid(id)) throw new DomainError('NOT_FOUND', 'Not found.');
  const postmortem = typeof input.postmortem === 'string' ? input.postmortem.trim() : '';
  if (postmortem.length > 5000) throw invalid('postmortem', 'Use at most 5000 characters.');
  const current = await tx.platformNotice.findUnique({ where: { id } });
  if (!current) throw new DomainError('NOT_FOUND', 'Not found.');
  const row = await tx.platformNotice.update({
    where: { id },
    data: {
      resolvedAt: current.resolvedAt ?? now,
      ...(postmortem ? { postmortem } : {}),
    },
  });
  return view(row);
}

/** The open notices (for the banner) and the last 20 (for the history). Anyone may read them. */
export async function readNotices(
  prisma?: PrismaClient,
): Promise<{ open: NoticeView[]; recent: NoticeView[] }> {
  return withSystem(async (tx) => {
    const rows = await tx.platformNotice.findMany({ orderBy: { createdAt: 'desc' }, take: 20 });
    const views = rows.map(view);
    return { open: views.filter((v) => !v.resolvedAt), recent: views };
  }, prisma);
}
