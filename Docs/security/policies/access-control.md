# Access control policy

**Owner:** security lead. **Review:** yearly; access itself reviewed quarterly.

## Repsy's own systems

Production systems: GitHub, Render (web, worker, database), Cloudflare (DNS, R2, Stream), Resend, Sentry, PostHog, Anthropic console, Google Cloud console, Microsoft Entra app registration, the domain registrar, the password manager.

1. **Joiners.** Access is requested by the person's manager, approved by the security lead, and limited to what the role needs. Record who, what, when and why.
2. **Movers.** When a role changes, remove access the new role does not need within 5 working days.
3. **Leavers.** Remove all access on the last working day (same day for an involuntary exit). Rotate any shared secret they could have seen.
4. **Strong authentication.** Two-step sign-in on every system above. Prefer hardware keys or authenticator apps over SMS.
5. **Database access.** Day-to-day access goes through the app. Direct database access uses the owner role only for migrations and incident work, and is recorded in the incident or change record.
6. **Platform admins** (`users.is_platform_admin`) are set only by the database owner and listed in the access review. Reading client data needs a support access grant with a reason (24 hours, audited).
7. **Quarterly review.** List every account on every production system, confirm each still needs its access, remove the rest, and file the signed review.

## In the product

Customer access is controlled by workspace roles (owner, admin, coach, assistant, client), enforced on every operation by `assertCan` and by database row-level security. Owners manage their team, can require two-step sign-in and single sign-on, and can see the audit log.
