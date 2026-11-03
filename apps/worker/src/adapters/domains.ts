import { resolveTxt } from 'node:dns/promises';
import { Resend } from 'resend';
import type { DnsPort, MailDomainPort, SendingDomainRecord } from '@kinetic/core';

/** PRD L4: TXT lookups through the system resolver. A missing name is simply no records. */
export const systemDns: DnsPort = {
  async txt(name) {
    try {
      return (await resolveTxt(name)).map((parts) => parts.join(''));
    } catch {
      return [];
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
}
