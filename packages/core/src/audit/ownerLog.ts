import type { TenantTx } from '@kinetic/db';
import { isManager } from '../authz/actor';
import type { ActorContext } from '../authz/actor';
import { DomainError } from '../errors';
import { isUuid } from '../uuid';

/**
 * PRD A14: the owner's audit log, content-free: who did what and when (assignments, client changes, exports and
 * deletions, support access, sign-ins revoked), never message text, notes or answers. Newest first, 50 a page.
 */
export const AUDIT_CATEGORIES = [
  'all',
  'assignments',
  'clients',
  'programs',
  'data',
  'access',
] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];
export const AUDIT_PAGE_SIZE = 50;

const PREFIXES: Record<Exclude<AuditCategory, 'all'>, string[]> = {
  assignments: ['assignment.', 'form.sent'],
  clients: ['client.', 'invite.', 'join_link.', 'client_tag.'],
  programs: ['program.', 'exercise.', 'checkin_template.'],
  data: ['export.', 'deletion.'],
  access: ['support.', 'session.revoked', 'settings.updated', 'organization.'],
};

/** Readable names for the actions the log shows; anything else shows its code. */
const LABEL: Record<string, string> = {
  'assignment.created': 'Assigned a program',
  'assignment.replaced': 'Replaced a program',
  'client.created': 'Added a client',
  'client.updated': 'Changed a client',
  'client.paused': 'Paused a client',
  'client.resumed': 'Resumed a client',
  'client.joined_by_link': 'A client joined by link',
  'invite.issued': 'Sent an invite',
  'invite.accepted': 'Accepted an invite',
  'invite.revoked': 'Revoked an invite',
  'join_link.created': 'Made a sign-up link',
  'join_link.revoked': 'Turned off a sign-up link',
  'program.created': 'Created a program',
  'program.version_committed': 'Saved a program version',
  'program.duplicated': 'Duplicated a program',
  'export.requested': 'Requested an export',
  'export.built': 'Export ready',
  'deletion.requested': 'Requested a deletion',
  'deletion.completed': 'Deleted client data',
  'support.granted': 'Granted support access',
  'support.revoked': 'Revoked support access',
  'support.client_read': 'Support viewed a client',
  'support.account_lookup': 'Support looked up an account',
  'session.revoked_all': 'Signed out all devices',
  'session.revoked_one': 'Signed out a device',
  'settings.updated': 'Changed settings',
  'organization.updated': 'Changed the workspace',
  'organization.branding_updated': 'Changed branding',
  'form.sent': 'Sent a form',
  'agreement.accepted': 'A client accepted an agreement',
  'agreement.archived': 'Archived an agreement',
  'agreement.published': 'Published an agreement',
  'assessment.archived': 'Archived an assessment',
  'assessment.assigned': 'Asked for an assessment',
  'assessment.ended': 'Ended an assessment',
  'assessment_photo.added': 'Added an assessment photo',
  'assessment_photo.deleted': 'Deleted an assessment photo',
  'automation.started': 'Started an automation',
  'challenge.archived': 'Archived a challenge',
  'checkin.reviewed': 'Reviewed a check-in',
  'checkin.submitted': 'A client sent a check-in',
  'checkin_template.created': 'Created a check-in form',
  'checkin_template.updated': 'Changed a check-in form',
  'client.calendar_link_made': 'Made a calendar link',
  'client.checkin_schedule_updated': 'Changed a check-in schedule',
  'client.context_updated': 'Changed a client context card',
  'client.pause_updated': 'Changed a pause',
  'client.stage_changed': 'Changed a client stage',
  'client.transferred': 'Moved a client to another coach',
  'client_tag.bulk_added': 'Tagged clients',
  'client_tag.created': 'Created a tag',
  'client_tag.deleted': 'Deleted a tag',
  'course.archived': 'Archived a course',
  'course.enrolled': 'Enrolled a client in a course',
  'course.unenrolled': 'Removed a client from a course',
  'exercise.alternatives_set': 'Set exercise alternatives',
  'exercise.created': 'Created an exercise',
  'goal.created': 'Set a goal',
  'group.archived': 'Archived a group',
  'group.members_set': 'Changed group members',
  'habit.created': 'Added a habit',
  'internal_note.created': 'Added a note',
  'internal_note.deleted': 'Deleted a note',
  'internal_note.updated': 'Edited a note',
  'lapse.recorded': 'Subscription lapsed',
  'lapse.resolved': 'Subscription restored',
  'lead.converted': 'Converted a lead',
  'lead.received': 'New application',
  'lead.stage_changed': 'Moved a lead',
  'meal_plan.archived': 'Archived a meal plan',
  'media.uploaded': 'Uploaded a file',
  'message.broadcast': 'Sent a broadcast',
  'message.schedule_cancelled': 'Cancelled a scheduled message',
  'message.scheduled': 'Scheduled a message',
  'message.sent': 'Sent a message',
  'nutrition.target_set': 'Set nutrition targets',
  'org.created': 'Created the workspace',
  'organization.public_page_updated': 'Changed the public page',
  'organization.reply_expectations_updated': 'Changed reply expectations',
  'phase.queued': 'Queued a program phase',
  'phase.started': 'Started a program phase',
  'program.archived': 'Archived a program',
  'program.renamed': 'Renamed a program',
  'program.restored': 'Restored a program',
  'progress_photo.added': 'Added a progress photo',
  'progress_photo.deleted': 'Deleted a progress photo',
  'progress_report.deleted': 'Deleted a progress report',
  'recipe.archived': 'Archived a recipe',
  'resource.archived': 'Archived a resource',
  'resource.created': 'Shared a resource',
  'review.seen': 'Marked the review list as seen',
  'review_flag.followup_created': 'Created a follow-up',
  'session.completed': 'Finished a workout',
  'session.exercise_swap_undone': 'Undid an exercise swap',
  'session.exercise_swapped': 'Swapped an exercise',
  'session.extra_started': 'Started an extra workout',
  'session.form_check_added': 'Added a form check',
  'session.logged_by_coach': 'Logged a workout for a client',
  'session.logs_revised': 'Corrected a workout log',
  'session.note_added': 'Added a workout note',
  'session.readiness_recorded': 'Recorded readiness',
  'session.rescheduled': 'Moved a workout',
  'session.started': 'Started a workout',
  'support.requested': 'Asked for support',
  'team.cover_ended': 'Ended cover',
  'team.cover_set': 'Set up cover',
  'team.invite_revoked': 'Revoked a team invite',
  'team.invited': 'Invited a team member',
  'team.joined': 'A team member joined',
  'team.removed': 'Removed a team member',
  'team.role_changed': 'Changed a team role',
};

/** Fallback for an action with no label yet: `client.stage_changed` reads "Client stage changed". */
export function humanizeAction(action: string): string {
  const text = action.replace(/[._]+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export interface AuditEntry {
  id: string;
  at: string;
  /** The person who acted; null for the system (worker jobs). */
  actorName: string | null;
  action: string;
  label: string;
  objectType: string;
  /** The client the event concerns, when it names one. */
  clientName: string | null;
}

const decodeCursor = (c: string | undefined) => {
  if (!c) return null;
  const [at, id] = Buffer.from(c, 'base64url').toString('utf8').split('|');
  const d = new Date(at ?? '');
  return id && isUuid(id) && !Number.isNaN(d.getTime()) ? { at: d, id } : null;
};

export async function listAuditLog(
  tx: TenantTx,
  actor: ActorContext,
  query: { category?: unknown; cursor?: string } = {},
): Promise<{ items: AuditEntry[]; nextCursor: string | null }> {
  if (!isManager(actor.role))
    throw new DomainError('FORBIDDEN', 'Only the workspace owner or an admin can see this.');
  const category = (AUDIT_CATEGORIES as readonly unknown[]).includes(query.category)
    ? (query.category as AuditCategory)
    : 'all';
  const cursor = decodeCursor(query.cursor);
  const and: Record<string, unknown>[] = [];
  if (category !== 'all') {
    and.push({
      OR: PREFIXES[category].map((p) =>
        p.endsWith('.') ? { action: { startsWith: p } } : { action: p },
      ),
    });
  } else {
    // Everyday activity (each message, set or note) isn't an owner's audit concern.
    and.push({
      OR: Object.values(PREFIXES)
        .flat()
        .map((p) => (p.endsWith('.') ? { action: { startsWith: p } } : { action: p })),
    });
  }
  if (cursor) {
    and.push({
      OR: [{ createdAt: { lt: cursor.at } }, { createdAt: cursor.at, id: { lt: cursor.id } }],
    });
  }
  const rows = await tx.auditEvent.findMany({
    where: { AND: and },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: AUDIT_PAGE_SIZE + 1,
    select: {
      id: true,
      createdAt: true,
      actorId: true,
      action: true,
      objectType: true,
      objectId: true,
      metadataJson: true,
    },
  });
  const page = rows.slice(0, AUDIT_PAGE_SIZE);
  const clientIdOf = (r: (typeof page)[number]) => {
    const m = r.metadataJson as { clientId?: unknown } | null;
    if (typeof m?.clientId === 'string' && isUuid(m.clientId)) return m.clientId;
    return r.objectType === 'client' && isUuid(r.objectId) ? r.objectId : null;
  };
  const actorIds = [...new Set(page.map((r) => r.actorId).filter((x): x is string => !!x))];
  const clientIds = [...new Set(page.map(clientIdOf).filter((x): x is string => !!x))];
  const users = actorIds.length
    ? await tx.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
    : [];
  const clients = clientIds.length
    ? await tx.client.findMany({
        where: { id: { in: clientIds } },
        select: { id: true, name: true },
      })
    : [];
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  const last = page[page.length - 1];
  return {
    items: page.map((r) => {
      const cid = clientIdOf(r);
      return {
        id: r.id,
        at: r.createdAt.toISOString(),
        actorName: r.actorId ? (userName.get(r.actorId) ?? 'Former member') : null,
        action: r.action,
        label: LABEL[r.action] ?? humanizeAction(r.action),
        objectType: r.objectType,
        clientName: cid ? (clientName.get(cid) ?? null) : null,
      };
    }),
    nextCursor:
      rows.length > AUDIT_PAGE_SIZE && last
        ? Buffer.from(`${last.createdAt.toISOString()}|${last.id}`).toString('base64url')
        : null,
  };
}
