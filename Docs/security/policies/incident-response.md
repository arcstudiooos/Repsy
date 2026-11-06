# Incident response plan

**Owner:** security lead (incident commander by default). **Review:** yearly, and after every Severity 1 or 2 incident. **Exercise:** one tabletop drill a year.

## What counts as an incident

Anything that threatens the confidentiality, integrity or availability of customer data or of Repsy: a leaked secret, unauthorised access, a cross-workspace data exposure, a lost laptop with access, malware, a sub-processor breach, a long outage, or data loss.

## Severity

| Severity | Examples                                                                                                  | Response                |
| -------- | --------------------------------------------------------------------------------------------------------- | ----------------------- |
| 1        | Customer data exposed or changed by someone unauthorised; production credentials leaked and possibly used | Start at once, any hour |
| 2        | Suspected exposure under investigation; a secret leaked with no sign of use; outage over 1 hour           | Within 4 hours          |
| 3        | A vulnerability with no sign of exploitation; minor outage                                                | Next working day        |

## Steps

1. **Report.** Anyone who suspects an incident tells the security lead straight away. Start an incident record (time, reporter, what was seen).
2. **Triage.** Set the severity. For Severity 1 or 2, name an incident commander and open a private channel.
3. **Contain.** Stop the harm first: rotate secrets, revoke sessions (`users` sign-out all devices, or delete session rows), disable the affected feature, block the source, take the service into maintenance if needed. Preserve logs and evidence before changing systems.
4. **Investigate.** Work out what happened, when, which workspaces and people are affected, and which data. Use request ids, the audit log, provider logs and Sentry.
5. **Notify.**
   - Affected customers (controllers): without undue delay and within **48 hours** of becoming aware of a personal data breach, as the DPA promises. Include what is known and what they should do.
   - Regulators: help customers meet their duties (for example 72 hours under the GDPR; the Data Protection Board of India under the DPDP rules). Where Repsy is itself the controller (its own account data), Repsy notifies.
   - Sub-processor incidents: follow the same path once the vendor tells us.
6. **Recover.** Fix the cause, restore from backup if data was lost (`docs/runbook.md`), and watch closely for repeat activity.
7. **Review.** Within 10 working days: a blameless written review with timeline, cause, impact, what went well, and actions with owners and dates. File it with the incident record.

## Contacts

Keep the current list (names, phone numbers, provider support links, counsel) in the password manager, not in this repository.
