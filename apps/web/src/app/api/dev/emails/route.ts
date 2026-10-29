import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { connection } from 'next/server';

/** Dev/E2E only: lists emails written by the worker's DevSinkEmailAdapter, newest first. */
export async function GET(): Promise<Response> {
  await connection();
  if (process.env.NODE_ENV === 'production') return new Response(null, { status: 404 });

  const dir = process.env.DEV_EMAIL_DIR ?? join(process.cwd(), '..', '..', '.dev-emails');
  const files = await readdir(dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  // File names start with an ISO timestamp, so reverse lexical order is newest first.
  const emails = await Promise.all(
    files
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse()
      .map(async (f) => JSON.parse(await readFile(join(dir, f), 'utf8')) as unknown),
  );
  return Response.json({ data: emails });
}
