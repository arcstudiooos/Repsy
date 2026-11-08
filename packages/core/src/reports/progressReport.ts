import { appendAudit, type TenantTx } from '@repsy/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { getBranding } from '../branding/branding';
import { DomainError } from '../errors';
import { getClientThread, sendMessage } from '../messages/messages';
import { BODY_METRICS, metricFromCanonical, metricUnit } from '../progress/metric-catalog';
import { getPersonalRecords } from '../progress/records';
import { fromDbDate, toDbDate } from '../sessions/read';
import { todayInZone } from '../timezone';
import { toDisplay, type Units } from '../units';
import { isUuid } from '../uuid';
import { A4, PdfDoc, type PdfPage, type Rgb, wrap } from './pdf';

/**
 * PRD E10: a monthly progress report for the client, as a branded PDF: workouts and check-ins done, body metrics
 * at the start and end of the month, personal records set, photos when the coach includes them, and the coach's
 * summary. The row keeps only the coach's choices; the PDF is built from current data each time it is opened.
 */
export const SUMMARY_MAX = 4000;
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export interface ProgressReportView {
  id: string;
  month: string;
  monthLabel: string;
  summary: string;
  includePhotos: boolean;
  updatedAt: string;
}

export interface ReportData {
  orgName: string;
  accent: string;
  clientName: string;
  monthLabel: string;
  month: string;
  units: Units;
  workouts: { done: number; planned: number; extra: number };
  checkins: { sent: number; due: number };
  metrics: { label: string; start: string; end: string; change: string }[];
  records: string[];
  photos: { storageKey: string; contentType: string; label: string }[];
  summary: string;
  coachName: string;
  generatedOn: string;
}

const notFound = () => new DomainError('NOT_FOUND', 'Not found.');
const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });

export const monthLabel = (month: string) =>
  new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    toDbDate(`${month}-01`),
  );
const nextMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};
const view = (r: {
  id: string;
  month: Date;
  summary: string;
  includePhotos: boolean;
  updatedAt: Date;
}): ProgressReportView => {
  const month = fromDbDate(r.month).slice(0, 7);
  return {
    id: r.id,
    month,
    monthLabel: monthLabel(month),
    summary: r.summary,
    includePhotos: r.includePhotos,
    updatedAt: r.updatedAt.toISOString(),
  };
};

/**
 * Creates the month's report for a client, or updates its summary. The first time, the client gets a message
 * saying it is ready (through the usual message notifications).
 */
export async function saveProgressReport(
  tx: TenantTx,
  actor: ActorContext,
  input: { clientId?: unknown; month?: unknown; summary?: unknown; includePhotos?: unknown },
  opts: { requestId?: string; now?: Date } = {},
): Promise<ProgressReportView & { created: boolean }> {
  assertCan(actor, 'client:update');
  const now = opts.now ?? new Date();
  if (!isUuid(input.clientId)) throw notFound();
  const client = await tx.client.findFirst({
    where: { id: input.clientId, status: { not: 'archived' } },
    select: { id: true, timezone: true, status: true },
  });
  if (!client) throw notFound();
  if (typeof input.month !== 'string' || !MONTH.test(input.month)) {
    throw invalid('month', 'Pick a month.');
  }
  if (input.month > todayInZone(client.timezone, now).slice(0, 7)) {
    throw invalid('month', 'Pick this month or an earlier one.');
  }
  const summary = typeof input.summary === 'string' ? input.summary.trim() : '';
  if (summary.length > SUMMARY_MAX) {
    throw invalid('summary', `Use at most ${SUMMARY_MAX} characters.`);
  }
  const includePhotos = input.includePhotos === true;
  const month = toDbDate(`${input.month}-01`);
  const existing = await tx.progressReport.findFirst({
    where: { clientId: client.id, month },
    select: { id: true },
  });
  const row = existing
    ? await tx.progressReport.update({
        where: { id: existing.id },
        data: { summary, includePhotos },
      })
    : await tx.progressReport.create({
        data: { clientId: client.id, month, summary, includePhotos, createdBy: actor.userId },
      } as Parameters<typeof tx.progressReport.create>[0]);
  if (!existing && client.status === 'active') {
    const thread = await getClientThread(tx, actor, client.id);
    await sendMessage(
      tx,
      actor,
      thread.id,
      {
        body: `Your progress report for ${monthLabel(input.month)} is ready. Open it from Progress.`,
        clientMessageId: row.id,
      },
      { now },
    );
  }
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'client',
    objectId: client.id,
    action: existing ? 'progress_report.updated' : 'progress_report.created',
    metadata: { reportId: row.id, month: input.month },
    requestId: opts.requestId,
  });
  return { ...view(row), created: !existing };
}

/** The client's reports, newest month first (a client sees their own). */
export async function listProgressReports(
  tx: TenantTx,
  actor: ActorContext,
  clientId?: unknown,
): Promise<ProgressReportView[]> {
  assertCan(actor, 'metric:read');
  const id = actor.role === 'client' ? actor.clientId : clientId;
  if (!isUuid(id)) throw notFound();
  const rows = await tx.progressReport.findMany({
    where: { clientId: id },
    orderBy: { month: 'desc' },
    take: 36,
    select: { id: true, month: true, summary: true, includePhotos: true, updatedAt: true },
  });
  return rows.map(view);
}

export async function deleteProgressReport(
  tx: TenantTx,
  actor: ActorContext,
  id: string,
  opts: { requestId?: string } = {},
): Promise<void> {
  assertCan(actor, 'client:update');
  if (!isUuid(id)) throw notFound();
  const row = await tx.progressReport.findFirst({
    where: { id },
    select: { id: true, clientId: true },
  });
  if (!row) throw notFound();
  await tx.progressReport.delete({ where: { id: row.id } });
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'client',
    objectId: row.clientId,
    action: 'progress_report.deleted',
    metadata: { reportId: row.id },
    requestId: opts.requestId,
  });
}

const fmtNum = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/** Everything the PDF shows, for the client or one of their coaches. */
export async function progressReportData(
  tx: TenantTx,
  actor: ActorContext,
  reportId: string,
  now: Date = new Date(),
): Promise<ReportData> {
  assertCan(actor, 'metric:read');
  if (!isUuid(reportId)) throw notFound();
  const report = await tx.progressReport.findFirst({
    where: {
      id: reportId,
      ...(actor.role === 'client' ? { clientId: actor.clientId ?? '' } : {}),
    },
    select: {
      month: true,
      summary: true,
      includePhotos: true,
      creator: { select: { name: true } },
      client: { select: { id: true, name: true, preferredUnits: true, timezone: true } },
    },
  });
  if (!report) throw notFound();
  const client = report.client;
  const units = client.preferredUnits as Units;
  const month = fromDbDate(report.month).slice(0, 7);
  const from = toDbDate(`${month}-01`);
  const to = toDbDate(`${nextMonth(month)}-01`);
  const inMonth = (d: string) => d.slice(0, 7) === month;

  const sessions = await tx.workoutSession.groupBy({
    by: ['state', 'kind'],
    where: { clientId: client.id, scheduledLocalDate: { gte: from, lt: to } },
    _count: { _all: true },
  });
  const count = (f: (s: (typeof sessions)[number]) => boolean) =>
    sessions.filter(f).reduce((a, s) => a + s._count._all, 0);
  const workouts = {
    planned: count((s) => s.kind === 'planned' && s.state !== 'cancelled'),
    done: count((s) => s.kind === 'planned' && s.state === 'completed'),
    extra: count((s) => s.kind === 'extra' && s.state === 'completed'),
  };
  const checkinRows = await tx.checkin.findMany({
    where: { clientId: client.id, kind: 'checkin', periodLocalDate: { gte: from, lt: to } },
    select: { submittedAt: true },
  });
  const checkins = {
    due: checkinRows.length,
    sent: checkinRows.filter((c) => c.submittedAt !== null).length,
  };

  const entries = await tx.metricEntry.findMany({
    where: { clientId: client.id, measuredOn: { lt: to } },
    orderBy: [{ measuredOn: 'asc' }, { createdAt: 'asc' }],
    select: { metric: true, measuredOn: true, value: true },
  });
  const metrics: ReportData['metrics'] = [];
  for (const def of BODY_METRICS) {
    const rows = entries.filter((e) => e.metric === def.key);
    const during = rows.filter((e) => e.measuredOn >= from);
    if (during.length === 0) continue;
    const before = rows.filter((e) => e.measuredOn < from).at(-1);
    const first = Number((before ?? during[0]!).value);
    const last = Number(during.at(-1)!.value);
    const show = (v: number) => metricFromCanonical(def.kind, v, units);
    const unit = metricUnit(def.kind, units);
    const delta = Math.round((show(last) - show(first)) * 10) / 10;
    metrics.push({
      label: def.label,
      start: `${fmtNum(show(first))} ${unit}`,
      end: `${fmtNum(show(last))} ${unit}`,
      change: delta === 0 ? 'no change' : `${delta > 0 ? '+' : ''}${fmtNum(delta)} ${unit}`,
    });
  }

  const records: string[] = [];
  for (const r of await getPersonalRecords(tx, actor, client.id)) {
    if (r.heaviest && inMonth(r.heaviest.localDate)) {
      const e1rm =
        r.estimatedOneRepMax && inMonth(r.estimatedOneRepMax.localDate)
          ? ` (estimated 1RM ${fmtNum(toDisplay(r.estimatedOneRepMax.valueKg, units))} ${units})`
          : '';
      records.push(
        `${r.name}: ${fmtNum(toDisplay(r.heaviest.weightKg, units))} ${units} × ${r.heaviest.reps}${e1rm}`,
      );
    } else if (r.estimatedOneRepMax && inMonth(r.estimatedOneRepMax.localDate)) {
      records.push(
        `${r.name}: estimated 1RM ${fmtNum(toDisplay(r.estimatedOneRepMax.valueKg, units))} ${units}`,
      );
    }
  }

  const photos: ReportData['photos'] = [];
  if (report.includePhotos) {
    const rows = await tx.progressPhoto.findMany({
      where: {
        clientId: client.id,
        takenOn: { gte: from, lt: to },
        media: { is: { erasedAt: null } },
      },
      orderBy: [{ takenOn: 'desc' }, { createdAt: 'desc' }],
      take: 30,
      select: {
        pose: true,
        takenOn: true,
        media: { select: { storageKey: true, contentType: true } },
      },
    });
    const day = rows[0] ? fromDbDate(rows[0].takenOn) : null;
    for (const pose of ['front', 'side', 'back']) {
      const p = rows.find((r) => fromDbDate(r.takenOn) === day && r.pose === pose);
      if (p) {
        photos.push({
          storageKey: p.media.storageKey,
          contentType: p.media.contentType,
          label: `${pose[0]!.toUpperCase()}${pose.slice(1)}, ${day}`,
        });
      }
    }
  }

  const brand = await getBranding(tx);
  return {
    orgName: brand.name,
    accent: brand.accent ?? '#0f766e',
    clientName: client.name,
    month,
    monthLabel: monthLabel(month),
    units,
    workouts,
    checkins,
    metrics,
    records: records.slice(0, 12),
    photos,
    summary: report.summary,
    coachName: report.creator.name,
    generatedOn: todayInZone(client.timezone, now),
  };
}

const hexRgb = (hex: string): Rgb => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  const v = m ? parseInt(m[1]!, 16) : 0x0f766e;
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
const INK: Rgb = [17, 24, 39];
const MUTED: Rgb = [75, 85, 99];
const RULE: Rgb = [209, 213, 219];
const WHITE: Rgb = [255, 255, 255];

/** Lays the report out as a PDF; `images` maps photo storage keys to their bytes (JPEGs are embedded). */
export function renderProgressReport(
  data: ReportData,
  images: Map<string, Uint8Array>,
): Uint8Array {
  const doc = new PdfDoc(`Progress report, ${data.monthLabel}, ${data.clientName}`);
  const accent = hexRgb(data.accent);
  const M = 48;
  const W = A4.width - M * 2;
  const BOTTOM = A4.height - 60;
  let page: PdfPage = doc.addPage();
  let y = 0;

  const header = () => {
    page.rect(0, 0, A4.width, 64, accent);
    page.text(M, 38, data.orgName, { size: 16, bold: true, color: WHITE });
  };
  header();
  y = 104;
  page.text(M, y, `Progress report: ${data.monthLabel}`, { size: 20, bold: true, color: INK });
  y += 22;
  page.text(M, y, data.clientName, { size: 13, color: MUTED });
  y += 30;

  const space = (h: number) => {
    if (y + h <= BOTTOM) return;
    page = doc.addPage();
    header();
    y = 100;
  };
  const heading = (t: string) => {
    space(40);
    page.text(M, y, t, { size: 13, bold: true, color: accent });
    y += 8;
    page.line(M, y, M + W, y, RULE);
    y += 18;
  };
  const para = (t: string, size = 11, color: Rgb = INK) => {
    for (const line of wrap(t, size, W)) {
      space(size + 5);
      page.text(M, y, line, { size, color });
      y += size + 5;
    }
  };

  heading('Training');
  const pct = data.workouts.planned
    ? ` (${Math.round((data.workouts.done / data.workouts.planned) * 100)}%)`
    : '';
  para(`Workouts completed: ${data.workouts.done} of ${data.workouts.planned}${pct}`);
  if (data.workouts.extra > 0) para(`Extra workouts logged: ${data.workouts.extra}`);
  if (data.checkins.due > 0) para(`Check-ins sent: ${data.checkins.sent} of ${data.checkins.due}`);
  y += 10;

  heading('Body metrics');
  if (data.metrics.length === 0) para('No measurements this month.', 11, MUTED);
  else {
    const cols = [M, M + 190, M + 290, M + 390];
    space(20);
    ['Measurement', 'Start', 'End', 'Change'].forEach((h, i) =>
      page.text(cols[i]!, y, h, { size: 10, bold: true, color: MUTED }),
    );
    y += 16;
    for (const m of data.metrics) {
      space(18);
      [m.label, m.start, m.end, m.change].forEach((v, i) =>
        page.text(cols[i]!, y, v, { size: 11, color: INK }),
      );
      y += 18;
    }
  }
  y += 10;

  heading('Personal records this month');
  if (data.records.length === 0) para('No new records this month.', 11, MUTED);
  for (const r of data.records) para(`• ${r}`);
  y += 10;

  const drawable = data.photos.flatMap((p) => {
    const bytes = images.get(p.storageKey);
    const name = bytes && p.contentType === 'image/jpeg' ? doc.addJpeg(bytes) : null;
    return name ? [{ ...p, name }] : [];
  });
  if (drawable.length > 0) {
    heading('Photos');
    const gap = 12;
    const cell = (W - gap * 2) / 3;
    space(cell * 1.4 + 24);
    let tallest = 0;
    drawable.forEach((p, i) => {
      const x = M + i * (cell + gap);
      const h = page.image(p.name, x, y, cell, cell * 1.4);
      tallest = Math.max(tallest, h);
      page.text(x, y + h + 14, p.label, { size: 9, color: MUTED });
    });
    y += tallest + 34;
  }

  if (data.summary) {
    heading(`From ${data.coachName}`);
    para(data.summary);
  }

  doc.pages.forEach((p, i) => {
    p.line(M, A4.height - 44, M + W, A4.height - 44, RULE);
    p.text(
      M,
      A4.height - 30,
      `Private: for ${data.clientName} and their coach. Made with Repsy on ${data.generatedOn}.`,
      { size: 8, color: MUTED },
    );
    p.text(M + W - 40, A4.height - 30, `${i + 1} / ${doc.pages.length}`, { size: 8, color: MUTED });
  });
  return doc.toBytes();
}
