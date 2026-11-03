import { sweepCustomDomains } from '@kinetic/core';
import { ResendMailDomains, systemDns } from '../adapters/domains';
import { defineJob } from './registry';

export const DOMAINS_VERIFY = 'domains.verify';
/** pg-boss cron: every five minutes. */
export const DOMAINS_VERIFY_CRON = '*/5 * * * *';

/** PRD L4 (D-013 #15): proves custom domains by their TXT record and follows branded-sending verification. */
export const domainsVerifyJob = defineJob<object>({
  name: DOMAINS_VERIFY,
  cron: DOMAINS_VERIFY_CRON,
  async handle(_data, deps) {
    const key = process.env.RESEND_API_KEY?.trim();
    const r = await sweepCustomDomains(deps.prisma, {
      dns: systemDns,
      mail: key ? new ResendMailDomains(key) : null,
    });
    if (r.verified > 0) deps.logger.info(r, 'custom domains verified');
  },
});
