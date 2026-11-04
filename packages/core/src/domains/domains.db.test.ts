import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { DomainError } from '../errors';
import { newOrg, runAs, type Org } from '../sessions/fixtures.test-helpers';
import { markDomainVerified, requestCustomDomain, setBrandedSender } from './domains';

/** PRD L4 against Postgres (review M7, L1): clear errors instead of 500s. */
let prisma: PrismaClient;
let drop: () => Promise<void>;
let a: Org;
let b: Org;

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: unknown) => (e instanceof DomainError ? e.code : String(e)),
  );

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
  a = await newOrg(prisma);
  b = await newOrg(prisma);
});
afterAll(async () => {
  await drop();
});

describe('custom domains', () => {
  it('M7: a hostname another workspace holds is a conflict, not a server error', async () => {
    const request = (org: Org) =>
      codeOf(
        runAs(prisma, org.coach, (tx) =>
          requestCustomDomain(tx, org.coach, { hostname: 'coach.example.com' }),
        ),
      );
    expect(await request(a)).toBe('ok');
    expect(await request(a)).toBe('CONFLICT');
    expect(await request(b)).toBe('CONFLICT');
  });

  it('L1: a malformed domain id is not found, not a server error', async () => {
    expect(
      await codeOf(runAs(prisma, a.coach, (tx) => markDomainVerified(tx, a.coach, 'not-a-uuid'))),
    ).toBe('NOT_FOUND');
    expect(
      await codeOf(
        runAs(prisma, a.coach, (tx) =>
          setBrandedSender(tx, a.coach, { domainId: 'nope', brandedFromLocal: 'hello' }),
        ),
      ),
    ).toBe('NOT_FOUND');
  });
});
