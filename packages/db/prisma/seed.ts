/**
 * `pnpm db:seed` — idempotent, synthetic data only. Needs SEED_PASSWORD (never committed).
 * Not for production databases.
 */
import { hashPassword } from 'better-auth/crypto';
// Relative on purpose: @repsy/core depends on @repsy/db, so a package import would be a cycle.
import { generatePilotCode } from '../../core/src/identity/pilotCode';
import { createPrismaClient } from '../src/client';
import { requireSeedPassword, seedDemo } from '../src/seed';

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed in production');
  const password = requireSeedPassword();
  // Blank counts as unset (.env.example ships `MIGRATION_DATABASE_URL=`).
  const url = process.env.MIGRATION_DATABASE_URL?.trim() || process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const prisma = createPrismaClient(url);
  try {
    const { pilotCode } = await seedDemo(prisma, password, { hashPassword, generatePilotCode });
    console.log('Seeded admin@example.test, coach@example.test and 3 demo clients.');
    if (pilotCode) {
      console.log(`Pilot code (shown once, only its hash is stored): ${pilotCode}`);
    } else {
      console.log('An unused pilot code already exists (plaintext is not recoverable).');
      console.log('Run `pnpm --filter @repsy/db pilot-code:create` for a new one.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
