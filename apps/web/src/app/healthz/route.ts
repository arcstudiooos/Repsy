import { connection } from 'next/server';
import { prisma } from '@repsy/db';

const DB_CHECK_MS = 3_000;

/** Render's health check: healthy only when this instance can reach the database. */
export async function GET(): Promise<Response> {
  await connection();
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), DB_CHECK_MS)),
    ]);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
