import { withSystem } from './tenant';
import type { PrismaClient } from './generated/client';

export const DEFAULT_PILOT_CODE_DAYS = 30;

/** Stores a pilot code hash, created by the first platform admin. Plaintext never touches the DB. */
export async function createPilotCodeRow(
  prisma: PrismaClient,
  input: { codeHash: string; expiresInDays?: number },
): Promise<{ id: string; expiresAt: Date }> {
  const days = input.expiresInDays ?? DEFAULT_PILOT_CODE_DAYS;
  if (!Number.isFinite(days) || days <= 0) throw new Error('expiresInDays must be positive');
  return withSystem(async (tx) => {
    const admin = await tx.user.findFirst({
      where: { isPlatformAdmin: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!admin) throw new Error('No platform admin exists yet. Run `pnpm db:seed` first.');
    const row = await tx.pilotCode.create({
      data: {
        codeHash: input.codeHash,
        createdBy: admin.id,
        expiresAt: new Date(Date.now() + days * 86_400_000),
      },
    });
    return { id: row.id, expiresAt: row.expiresAt };
  }, prisma);
}
