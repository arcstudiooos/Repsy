import { appendAudit, type TenantTx } from '@kinetic/db';
import { isManager } from '../authz/actor';
import type { ActorContext } from '../authz/actor';
import { DomainError } from '../errors';
import { isUuid } from '../uuid';

/**
 * PRD B14: terms and waivers the client accepts in the portal. Each edit of the text is a new version; a client who
 * accepted an older version is asked again before the portal opens. Acceptances keep the version, the time and the
 * IP address they came from, and are never edited.
 */
export const AGREEMENT_TITLE_MAX = 120;
export const AGREEMENT_BODY_MAX = 20_000;
export const AGREEMENTS_MAX = 10;

export interface AgreementView {
  id: string;
  title: string;
  body: string;
  version: number;
  updatedAt: string;
}

export interface AcceptanceView {
  agreementId: string;
  title: string;
  /** The current version; `acceptedVersion` below it means the client must accept again. */
  version: number;
  acceptedVersion: number | null;
  acceptedAt: string | null;
}

const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });
const notFound = () => new DomainError('NOT_FOUND', 'Agreement not found.');
const ownerOnly = (actor: ActorContext) => {
  if (!isManager(actor.role)) {
    throw new DomainError(
      'FORBIDDEN',
      'Only the workspace owner or an admin can change agreements.',
    );
  }
};

function clean(input: { title?: unknown; body?: unknown }) {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const body = typeof input.body === 'string' ? input.body.trim() : '';
  if (title.length < 1 || title.length > AGREEMENT_TITLE_MAX) {
    throw invalid('title', `Use 1-${AGREEMENT_TITLE_MAX} characters.`);
  }
  if (body.length < 20 || body.length > AGREEMENT_BODY_MAX) {
    throw invalid('body', `Use 20-${AGREEMENT_BODY_MAX} characters.`);
  }
  return { title, body };
}

const view = (r: {
  id: string;
  title: string;
  body: string;
  version: number;
  updatedAt: Date;
}) => ({
  id: r.id,
  title: r.title,
  body: r.body,
  version: r.version,
  updatedAt: r.updatedAt.toISOString(),
});

/** The workspace's live agreements (coaches and clients both read them). */
export async function listAgreements(tx: TenantTx): Promise<AgreementView[]> {
  const rows = await tx.agreement.findMany({
    where: { archivedAt: null },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map(view);
}

export async function createAgreement(
  tx: TenantTx,
  actor: ActorContext,
  input: { title?: unknown; body?: unknown },
  opts: { requestId?: string } = {},
): Promise<AgreementView> {
  ownerOnly(actor);
  const data = clean(input);
  if ((await tx.agreement.count({ where: { archivedAt: null } })) >= AGREEMENTS_MAX) {
    throw new DomainError('CONFLICT', `A workspace can have at most ${AGREEMENTS_MAX} agreements.`);
  }
  const row = await tx.agreement.create({
    data: { ...data, version: 1 },
  } as Parameters<typeof tx.agreement.create>[0]);
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'agreement',
    objectId: row.id,
    action: 'agreement.published',
    metadata: { version: 1 },
    requestId: opts.requestId,
  });
  return view(row);
}

/** A changed text is a new version: every client accepts it again. A title-only change keeps the version. */
export async function updateAgreement(
  tx: TenantTx,
  actor: ActorContext,
  id: unknown,
  input: { title?: unknown; body?: unknown },
  opts: { requestId?: string } = {},
): Promise<AgreementView> {
  ownerOnly(actor);
  if (!isUuid(id)) throw notFound();
  const current = await tx.agreement.findFirst({ where: { id, archivedAt: null } });
  if (!current) throw notFound();
  const data = clean(input);
  const version = data.body === current.body ? current.version : current.version + 1;
  const row = await tx.agreement.update({ where: { id }, data: { ...data, version } });
  if (version !== current.version) {
    await appendAudit(tx, {
      orgId: actor.orgId,
      actorId: actor.userId,
      objectType: 'agreement',
      objectId: id,
      action: 'agreement.published',
      metadata: { version },
      requestId: opts.requestId,
    });
  }
  return view(row);
}

export async function archiveAgreement(
  tx: TenantTx,
  actor: ActorContext,
  id: unknown,
  opts: { requestId?: string; now?: Date } = {},
): Promise<void> {
  ownerOnly(actor);
  if (!isUuid(id)) throw notFound();
  const { count } = await tx.agreement.updateMany({
    where: { id, archivedAt: null },
    data: { archivedAt: opts.now ?? new Date() },
  });
  if (count === 0) throw notFound();
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'agreement',
    objectId: id,
    action: 'agreement.archived',
    requestId: opts.requestId,
  });
}

/** Each live agreement with the client's latest acceptance of it. */
export async function acceptancesFor(tx: TenantTx, clientId: string): Promise<AcceptanceView[]> {
  const agreements = await tx.agreement.findMany({
    where: { archivedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true, title: true, version: true },
  });
  if (agreements.length === 0) return [];
  const accepted = await tx.agreementAcceptance.findMany({
    where: { clientId, agreementId: { in: agreements.map((a) => a.id) } },
    orderBy: { version: 'desc' },
    select: { agreementId: true, version: true, acceptedAt: true },
  });
  return agreements.map((a) => {
    const latest = accepted.find((x) => x.agreementId === a.id);
    return {
      agreementId: a.id,
      title: a.title,
      version: a.version,
      acceptedVersion: latest?.version ?? null,
      acceptedAt: latest?.acceptedAt.toISOString() ?? null,
    };
  });
}

/** What the signed-in client still has to accept before the portal opens. */
export async function pendingAgreements(
  tx: TenantTx,
  actor: ActorContext,
): Promise<AgreementView[]> {
  if (actor.role !== 'client' || !actor.clientId) return [];
  const status = await acceptancesFor(tx, actor.clientId);
  const due = new Set(
    status.filter((s) => s.acceptedVersion !== s.version).map((s) => s.agreementId),
  );
  if (due.size === 0) return [];
  return (await listAgreements(tx)).filter((a) => due.has(a.id));
}

export async function acceptAgreement(
  tx: TenantTx,
  actor: ActorContext,
  id: unknown,
  input: { version?: unknown; ip?: string | null },
  opts: { now?: Date; requestId?: string } = {},
): Promise<void> {
  if (actor.role !== 'client' || !actor.clientId) {
    throw new DomainError('FORBIDDEN', 'Only the client accepts their agreements.');
  }
  if (!isUuid(id)) throw notFound();
  const a = await tx.agreement.findFirst({ where: { id, archivedAt: null } });
  if (!a) throw notFound();
  // Accepting what was on screen: a version changed meanwhile must be read again.
  if (input.version !== a.version) {
    throw new DomainError(
      'CONFLICT',
      'These terms changed. Read the new version and accept again.',
    );
  }
  await tx.agreementAcceptance.createMany({
    data: [
      {
        agreementId: a.id,
        version: a.version,
        clientId: actor.clientId,
        userId: actor.userId,
        acceptedAt: opts.now ?? new Date(),
        ip: input.ip?.slice(0, 64) ?? null,
      },
    ] as never,
    skipDuplicates: true,
  });
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'agreement',
    objectId: a.id,
    action: 'agreement.accepted',
    metadata: { clientId: actor.clientId, version: a.version },
    requestId: opts.requestId,
  });
}
