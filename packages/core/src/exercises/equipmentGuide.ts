import type { TenantTx } from '@repsy/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { alternativesFor, type AlternativeView } from './alternatives';
import { outsideKit } from './options';

export interface EquipmentGuide {
  clientName: string;
  kit: string[];
  /** Per exercise id in the program: its equipment and the coach's alternatives that fit the kit. */
  exercises: Record<string, { equipment: string; fits: AlternativeView[] }>;
}

/**
 * What the builder needs to warn about exercises outside a client's kit and offer swaps (PRD B13, C4). Null when
 * the client has no kit recorded, so nothing warns.
 */
export async function equipmentGuideFor(
  tx: TenantTx,
  actor: ActorContext,
  clientId: string,
  exerciseIds: string[],
): Promise<EquipmentGuide | null> {
  assertCan(actor, 'program:read');
  const client = await tx.client.findFirst({
    where: { id: clientId },
    select: { name: true, equipment: true },
  });
  if (!client || client.equipment.length === 0) return null;
  const ids = [...new Set(exerciseIds)];
  const rows = await tx.exercise.findMany({
    where: { id: { in: ids } },
    select: { id: true, equipment: true },
  });
  const alternatives = await alternativesFor(tx, ids);
  const exercises: EquipmentGuide['exercises'] = {};
  for (const r of rows) {
    exercises[r.id] = {
      equipment: r.equipment,
      fits: (alternatives[r.id] ?? []).filter((a) => !outsideKit(a.equipment, client.equipment)),
    };
  }
  return { clientName: client.name, kit: client.equipment, exercises };
}
