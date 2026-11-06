# Information security policy

**Owner:** security lead (founder). **Applies to:** everyone who works on Repsy, including contractors. **Review:** yearly.

## Purpose

Protect the confidentiality, integrity and availability of Repsy's systems and of the data coaches and their clients trust us with, much of it health-related.

## Rules

1. **Data classification.**
   - _Restricted_: client health data, messages, progress photos, credentials, secrets, backups. Only in production systems; never on laptops, in chat, email, tickets or the repository.
   - _Confidential_: customer lists, business metrics, pen test reports, internal docs.
   - _Public_: marketing site, published docs.
2. **Secrets** live only in the hosting provider's secret store and a password manager. Never commit them, paste them into chat or AI tools, or put them in screenshots. A secret that leaks is rotated the same day.
3. **Accounts.** Every person has their own named account on every system. Two-step sign-in is on everywhere it is offered. No shared logins.
4. **Least privilege.** Production access only for people who need it, removed when they no longer do (see `access-control.md`).
5. **Devices.** Laptops used for Repsy have full-disk encryption, a screen lock of 5 minutes or less, automatic OS updates, and (once there is an MDM) are enrolled in it.
6. **Real customer data is never used** for development or testing. Use seed data and synthetic fixtures.
7. **Changes** follow `change-management.md`. **Incidents** follow `incident-response.md`. **Vendors** follow `vendor-management.md`.
8. **AI tools** used in development may see source code but never Restricted data or secrets.
9. **Report** anything suspicious to the security lead straight away. Nobody is blamed for reporting.

## Exceptions

Written, approved by the security lead, time-limited, and recorded in the risk register.

## Enforcement

Breaking this policy can lead to loss of access and disciplinary action, up to ending the contract.
