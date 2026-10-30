import {
  listClients,
  listPrograms,
  type ActorContext,
  type ClientView,
  type ProgramSummary,
} from '@kinetic/core';
import type { TenantTx } from '@kinetic/db';

/** Most options a select offers; beyond this the UI shows a hint. */
export const SELECT_CAP = 200;

export interface Collected<T> {
  items: T[];
  /** More existed than the cap allows. */
  capped: boolean;
}

/** Follows `nextCursor` until exhausted or `cap` items are held. */
export async function collectPages<T>(
  fetchPage: (cursor?: string) => Promise<{ items: T[]; nextCursor: string | null }>,
  cap: number = SELECT_CAP,
): Promise<Collected<T>> {
  const items: T[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await fetchPage(cursor);
    items.push(...page.items);
    if (page.nextCursor === null) break;
    if (items.length >= cap) return { items: items.slice(0, cap), capped: true };
    cursor = page.nextCursor;
  }
  return items.length > cap
    ? { items: items.slice(0, cap), capped: true }
    : { items, capped: false };
}

export const loadAllTemplates = (
  tx: TenantTx,
  actor: ActorContext,
): Promise<Collected<ProgramSummary>> =>
  collectPages((cursor) => listPrograms(tx, actor, { kind: 'template', cursor }));

/** Only active clients can be assigned a program. */
export const loadActiveClients = (
  tx: TenantTx,
  actor: ActorContext,
): Promise<Collected<ClientView>> =>
  collectPages((cursor) => listClients(tx, actor, { status: 'active', cursor }));
