import { resolveTxt } from 'node:dns/promises';
import { Resend } from 'resend';
import {
  DnsNoRecord,
  type DnsPort,
  type MailDomainPort,
  type SendingDomainRecord,
} from '@kinetic/core';

/**
 * PRD L4: TXT lookups through the system resolver. Only "no such name / no such record" means there are none; any
 * other failure (timeout, SERVFAIL) is passed on, so the sweep changes nothing (final review #3).
 */
export const systemDns: DnsPort = {
  async txt(name) {
    try {
      return (await resolveTxt(name)).map((parts) => parts.join(''));
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'ENOTFOUND' || code === 'ENODATA') throw new DnsNoRecord();
      throw e;
    }
  },
};

/** PRD L4 (D-013 #15): branded sending through Resend's domains API. */
export class ResendMailDomains implements MailDomainPort {
  private readonly client: Resend;
  constructor(apiKey: string) {
    this.client = new Resend(apiKey);
  }

  async create(hostname: string): Promise<{ ref: string; records: SendingDomainRecord[] }> {
    const { data, error } = await this.client.domains.create({ name: hostname });
    if (error || !data) throw new Error(`Resend refused the domain: ${error?.name ?? 'unknown'}`);
    return {
      ref: data.id,
      records: data.records.map((r) => ({ type: r.type, name: r.name, value: r.value })),
    };
  }

  async status(ref: string): Promise<'pending' | 'verified' | 'failed'> {
    // Ask Resend to look again, then read where it stands.
    await this.client.domains.verify(ref);
    const { data, error } = await this.client.domains.get(ref);
    if (error || !data) throw new Error(`Resend lookup failed: ${error?.name ?? 'unknown'}`);
    return data.status === 'verified'
      ? 'verified'
      : data.status === 'failed'
        ? 'failed'
        : 'pending';
  }

  async remove(ref: string): Promise<void> {
    const { error } = await this.client.domains.remove(ref);
    // Already gone is done.
    if (error && error.name !== 'not_found') {
      throw new Error(`Resend refused the removal: ${error.name}`);
    }
  }
}
