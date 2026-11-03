import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import type { ActorContext } from '../authz/actor';
import { DomainError } from '../errors';
import { newOrg, runAs } from '../sessions/fixtures.test-helpers';
import {
  addCustomDomain,
  brandedFromFor,
  cleanHostname,
  getCustomDomain,
  publicSlugForHost,
  sweepCustomDomains,
  type DnsPort,
  type MailDomainPort,
} from './domains';

let prisma: PrismaClient;
let drop: () => Promise<void>;
beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: unknown) => (e instanceof DomainError ? e.code : `other:${String(e)}`),
  );
const ctx = { appHost: 'app.repsy.test' };

class FakeDns implements DnsPort {
  records = new Map<string, string[]>();
  txt(name: string) {
    return Promise.resolve(this.records.get(name) ?? []);
  }
}
class FakeMail implements MailDomainPort {
  state: 'pending' | 'verified' = 'pending';
  create(hostname: string) {
    return Promise.resolve({
      ref: `dom_${hostname}`,
      records: [{ type: 'TXT', name: `resend._domainkey.${hostname}`, value: 'p=KEY' }],
    });
  }
  status() {
    return Promise.resolve(this.state);
  }
}

let n = 0;
async function workspace(publicPage = true) {
  const org = await newOrg(prisma);
  const slug = `dom-${Date.now().toString(36)}-${n++}`;
  await withSystem(
    (tx) =>
      tx.organization.update({
        where: { id: org.orgId },
        data: { publicSlug: slug, publicPageEnabled: publicPage, name: 'Fit "Co" <x>' },
      }),
    prisma,
  );
  return { ...org, slug };
}

describe('custom domains (L4, D-013 #15)', () => {
  it('accepts plain hostnames only, never the app’s own', () => {
    expect(cleanHostname(' Coach.Example.COM. ', ctx.appHost)).toBe('coach.example.com');
    for (const bad of [
      'https://x.test',
      'x.test/path',
      '10.0.0.1',
      '*.x.test',
      'localhost',
      'a.app.repsy.test',
      'x.test:8080',
    ]) {
      expect(() => cleanHostname(bad, ctx.appHost)).toThrow(DomainError);
    }
  });

  it('one per workspace, unique across workspaces; managers only', async () => {
    const a = await workspace();
    const b = await workspace();
    const host = `coach-${n}.example.test`;
    await runAs(prisma, a.coach, (tx) => addCustomDomain(tx, a.coach, { hostname: host }, ctx));
    expect(
      await code(
        runAs(prisma, a.coach, (tx) => addCustomDomain(tx, a.coach, { hostname: `x${host}` }, ctx)),
      ),
    ).toBe('CONFLICT');
    expect(
      await code(
        runAs(prisma, b.coach, (tx) => addCustomDomain(tx, b.coach, { hostname: host }, ctx)),
      ),
    ).toBe('CONFLICT');
    const coach: ActorContext = { ...b.coach, role: 'coach' };
    expect(await code(runAs(prisma, coach, (tx) => getCustomDomain(tx, coach)))).toBe('FORBIDDEN');
    // B can't see A's domain.
    expect(await runAs(prisma, b.coach, (tx) => getCustomDomain(tx, b.coach))).toBeNull();
  });

  it('verifies by TXT record, then serves the public page and sets up branded sending', async () => {
    const a = await workspace();
    const host = `brand-${n}.example.test`;
    const d = await runAs(prisma, a.coach, (tx) =>
      addCustomDomain(tx, a.coach, { hostname: host }, ctx),
    );
    const dns = new FakeDns();
    const mail = new FakeMail();
    const now = new Date();
    // Not yet proved: not served.
    await sweepCustomDomains(prisma, { dns, mail }, now);
    expect(await publicSlugForHost(prisma, host)).toBeNull();

    dns.records.set(d.txtName, ['something else', d.txtValue]);
    const later = new Date(now.getTime() + 10 * 60_000);
    expect(await sweepCustomDomains(prisma, { dns, mail }, later)).toMatchObject({ verified: 1 });
    expect(await publicSlugForHost(prisma, `${host.toUpperCase()}:443`)).toBe(a.slug);
    const view = await runAs(prisma, a.coach, (tx) => getCustomDomain(tx, a.coach));
    expect(view).toMatchObject({ status: 'verified', sendingStatus: 'pending' });
    expect(view?.sendingRecords[0]?.name).toBe(`resend._domainkey.${host}`);
    // Not sending from it until the provider verifies.
    expect(await withSystem((tx) => brandedFromFor(tx, a.orgId), prisma)).toBeNull();
    mail.state = 'verified';
    await sweepCustomDomains(prisma, { dns, mail }, new Date(later.getTime() + 60_000));
    // The display name can't break out of its quotes.
    expect(await withSystem((tx) => brandedFromFor(tx, a.orgId), prisma)).toBe(
      `"Fit Co x" <hello@${host}>`,
    );

    // A disabled public page is never served, even on a verified domain.
    await withSystem(
      (tx) =>
        tx.organization.update({ where: { id: a.orgId }, data: { publicPageEnabled: false } }),
      prisma,
    );
    expect(await publicSlugForHost(prisma, host)).toBeNull();
  });
});
