/** `pnpm --filter @kinetic/db pilot-code:create [--expires-days N]` — prints the code once. */
// Relative on purpose: @kinetic/core depends on @kinetic/db, so a package import would be a cycle.
import { generatePilotCode } from '../../core/src/identity/pilotCode';
import { createPrismaClient } from '../src/client';
import { DEFAULT_PILOT_CODE_DAYS, createPilotCodeRow } from '../src/pilotCodes';

function parseDays(argv: string[]): number {
  const index = argv.indexOf('--expires-days');
  if (index === -1) return DEFAULT_PILOT_CODE_DAYS;
  const days = Number(argv[index + 1]);
  if (!Number.isInteger(days) || days < 1)
    throw new Error('--expires-days must be a positive integer');
  return days;
}

async function main(): Promise<void> {
  const days = parseDays(process.argv.slice(2));
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const { code, codeHash } = generatePilotCode();
  const prisma = createPrismaClient(url);
  try {
    const row = await createPilotCodeRow(prisma, { codeHash, expiresInDays: days });
    console.log(`Pilot code (shown once, only its hash is stored): ${code}`);
    console.log(`Expires: ${row.expiresAt.toISOString()}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
