import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client';

export function createPrismaClient(connectionString: string, schema?: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString }, schema ? { schema } : undefined);
  return new PrismaClient({ adapter });
}

let instance: PrismaClient | undefined;

function getPrisma(): PrismaClient {
  if (!instance) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    instance = createPrismaClient(url);
  }
  return instance;
}

/** Lazily-connected shared client; resolves DATABASE_URL on first use. */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getPrisma();
    const value = Reflect.get(client, prop, client) as unknown;
    return typeof value === 'function' ? value.bind(client) : value;
  },
});
