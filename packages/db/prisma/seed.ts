/**
 * `pnpm db:seed` — idempotent, synthetic data only. Needs SEED_PASSWORD (never committed).
 * Not for production databases.
 */
import { hashPassword } from 'better-auth/crypto';
// Relative on purpose: @kinetic/core depends on @kinetic/db, so a package import would be a cycle.
import { generatePilotCode } from '../../core/src/identity/pilotCode';
import { createPrismaClient } from '../src/client';
import { requireSeedPassword, seedDemo } from '../src/seed';

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed in production');
  const password = requireSeedPassword();
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const prisma = createPrismaClient(url);
  try {
    const { pilotCode } = await seedDemo(prisma, password, { hashPassword, generatePilotCode });
    console.log('Seeded admin@example.test, coach@example.test and 3 demo clients.');
    if (pilotCode) {
      console.log(`Pilot code (shown once, only its hash is stored): ${pilotCode}`);
    } else {
      console.log('An unused pilot code already exists (plaintext is not recoverable).');
      console.log('Run `pnpm --filter @kinetic/db pilot-code:create` for a new one.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
