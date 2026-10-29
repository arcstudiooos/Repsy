import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface EnvVar {
  key?: string;
  value?: string;
  sync?: boolean;
  fromGroup?: string;
  fromDatabase?: { name: string; property: string };
}
interface Service {
  type: string;
  name: string;
  plan?: string;
  runtime?: string;
  buildCommand?: string;
  startCommand?: string;
  preDeployCommand?: string;
  healthCheckPath?: string;
  envVars?: EnvVar[];
}
interface Blueprint {
  services: Service[];
  databases: Array<{ name: string; plan?: string }>;
  envVarGroups: Array<{ name: string; envVars: EnvVar[] }>;
}

const file = fileURLToPath(new URL('../../../render.yaml', import.meta.url));
const blueprint = parse(readFileSync(file, 'utf8')) as Blueprint;
const service = (name: string) => blueprint.services.find((s) => s.name === name);
const group = () => blueprint.envVarGroups[0];
const groupKeys = () => (group()?.envVars ?? []).map((v) => v.key);

describe('render.yaml blueprint', () => {
  it('declares web, worker and a Postgres database', () => {
    expect(blueprint.services.map((s) => `${s.type}:${s.name}`).sort()).toEqual([
      'web:web',
      'worker:worker',
    ]);
    expect(blueprint.databases).toHaveLength(1);
    expect(blueprint.databases[0]?.plan).toBeTruthy();
  });

  it('web builds, migrates as owner before deploy, serves /healthz', () => {
    const web = service('web');
    expect(web?.plan).toBe('starter');
    expect(web?.runtime).toBe('node');
    expect(web?.buildCommand).toContain('pnpm install --frozen-lockfile');
    expect(web?.buildCommand).toContain('pnpm --filter @kinetic/web build');
    expect(web?.startCommand).toBe('pnpm --filter @kinetic/web start');
    expect(web?.preDeployCommand).toContain('prisma migrate deploy');
    expect(web?.preDeployCommand).toContain('MIGRATION_DATABASE_URL');
    expect(web?.preDeployCommand).toContain('pgboss:migrate');
    expect(web?.healthCheckPath).toBe('/healthz');
  });

  it('worker starts the worker package', () => {
    expect(service('worker')?.startCommand).toBe('pnpm --filter @kinetic/worker start');
  });

  it('the owner connection string comes from the database and only reaches web', () => {
    const owner = service('web')?.envVars?.find((v) => v.key === 'MIGRATION_DATABASE_URL');
    expect(owner?.fromDatabase?.name).toBe(blueprint.databases[0]?.name);
    expect(owner?.fromDatabase?.property).toBe('connectionString');
    expect(groupKeys()).not.toContain('MIGRATION_DATABASE_URL');
    expect(service('worker')?.envVars?.some((v) => v.key === 'MIGRATION_DATABASE_URL')).toBeFalsy();
  });

  it('both services use the shared env group', () => {
    for (const name of ['web', 'worker']) {
      expect(service(name)?.envVars).toContainEqual({ fromGroup: group()?.name });
    }
  });

  it('shared group has the required keys, secrets unsynced, proxy hop pinned', () => {
    for (const key of [
      'NODE_ENV',
      'DATABASE_URL',
      'BETTER_AUTH_SECRET',
      'BETTER_AUTH_URL',
      'APP_BASE_URL',
      'TRUSTED_PROXY_HOPS',
      'EMAIL_FROM',
      'RESEND_API_KEY',
      'SENTRY_DSN',
      'ANALYTICS_HASH_SECRET',
    ]) {
      expect(groupKeys()).toContain(key);
    }
    const vars = new Map((group()?.envVars ?? []).map((v) => [v.key, v]));
    expect(vars.get('TRUSTED_PROXY_HOPS')?.value).toBe('1');
    expect(vars.get('NODE_ENV')?.value).toBe('production');
    for (const secret of [
      'DATABASE_URL',
      'BETTER_AUTH_SECRET',
      'RESEND_API_KEY',
      'ANALYTICS_HASH_SECRET',
      'SENTRY_DSN',
    ]) {
      expect(vars.get(secret)?.sync).toBe(false);
      expect(vars.get(secret)?.value).toBeUndefined();
    }
  });

  it('commits no secret-looking values', () => {
    const raw = readFileSync(file, 'utf8');
    expect(raw).not.toMatch(/postgres(ql)?:\/\/[^\s]*:[^\s@]+@/);
    expect(raw).not.toMatch(/re_[A-Za-z0-9]{10,}/);
  });
});
