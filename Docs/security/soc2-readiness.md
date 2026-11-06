# SOC 2 readiness

Target: SOC 2 Type I covering **Security** (the Common Criteria), then Type II. Add **Confidentiality** and **Availability** once customers ask for them. Privacy and Processing Integrity are not planned.

Status key: **Done** (control exists and has evidence), **Partial** (exists but evidence or formality is missing), **Gap** (not in place).

## Common Criteria gap assessment

| Criteria     | Area                        | Status  | What exists                                                         | What is missing                                                                                                                                                |
| ------------ | --------------------------- | ------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CC1          | Control environment         | Partial | Policies in `policies/`; founder owns security.                     | Signed acknowledgement by each team member; code of conduct; background checks for staff with production access; org chart.                                    |
| CC2          | Communication               | Partial | Privacy policy, terms, `SECURITY.md`, status of sub-processors.     | Public security page; customer notice process for changes; internal security training record.                                                                  |
| CC3          | Risk assessment             | Gap     | Threats considered in architecture decisions (`docs/decisions.md`). | Yearly written risk assessment with a risk register (likelihood, impact, owner, treatment). Template in `policies/risk-management.md`.                         |
| CC4          | Monitoring of controls      | Gap     | CI runs on every change.                                            | Compliance tool or a quarterly control review with evidence; tracking of findings to closure.                                                                  |
| CC5          | Control activities          | Partial | Policies and technical controls documented.                         | Mapping each control to an owner and evidence source in the compliance tool.                                                                                   |
| CC6.1        | Logical access              | Done    | RLS, roles, 2FA, SSO, server-side sessions (`controls.md`).         | Evidence export (screenshots or tool integration).                                                                                                             |
| CC6.2 to 6.3 | Provisioning and removal    | Partial | Team invites, role changes, member removal in the product.          | Written joiner, mover, leaver checklist for Repsy's own staff accounts (GitHub, Render, Cloudflare, Resend, Google Workspace); quarterly access review record. |
| CC6.6        | Boundary protection         | Done    | Cloudflare in front; HTTPS only; security headers.                  | Evidence.                                                                                                                                                      |
| CC6.7        | Data in transit and at rest | Done    | TLS, HSTS, provider encryption at rest, app-level token encryption. | Evidence.                                                                                                                                                      |
| CC6.8        | Malicious software          | Partial | Dependabot updates; lockfile installs in CI.                        | Endpoint protection and disk encryption on staff laptops (MDM); secret scanning in CI.                                                                         |
| CC7.1        | Vulnerability management    | Partial | Dependabot; annual pen test planned.                                | Pen test done; dependency audit step in CI; fix-time tracking (see `policies/vulnerability-management.md`).                                                    |
| CC7.2 to 7.3 | Monitoring and detection    | Partial | Sentry errors; request-id logs; audit log.                          | Alerting on auth anomalies (many failed sign-ins, new platform admin); log retention policy with central log storage.                                          |
| CC7.4 to 7.5 | Incident response           | Partial | `policies/incident-response.md`.                                    | A yearly tabletop exercise record; post-incident reviews filed.                                                                                                |
| CC8.1        | Change management           | Done    | Pull requests, required CI, migrations reviewed, `db:diff` check.   | Branch protection settings exported as evidence; required reviewer once there is a second engineer.                                                            |
| CC9.1        | Business continuity         | Partial | Daily backups; restore drill procedure in `docs/runbook.md`.        | Restore drill records each quarter; documented RTO/RPO (see `policies/business-continuity.md`).                                                                |
| CC9.2        | Vendor management           | Partial | `subprocessors.md`.                                                 | Yearly vendor review: collect each vendor's SOC 2 report or equivalent, record the review.                                                                     |

## Steps to Type I

1. **Pick a compliance automation tool** (Vanta, Drata, Secureframe or Sprinto). Connect GitHub, Render, Cloudflare, Google Workspace and staff laptops (MDM). This produces most evidence automatically.
2. **Close the gaps marked Gap**, then the Partial items, in the order: access reviews, risk assessment, MDM on laptops, alerting, restore drill records.
3. **Have every team member read and accept the policies** in the tool.
4. **Run the first penetration test** (`pentest-plan.md`) and fix findings.
5. **Choose an auditor** (an AICPA-licensed CPA firm; many partner with the compliance tools). Agree the scope: the Repsy production system, Security criteria.
6. **Readiness review** with the auditor, then the Type I audit (a point-in-time check of control design).

## Steps to Type II

1. Start the observation window the day after Type I (3 months minimum, 6 to 12 is typical and better regarded).
2. Run every recurring control on schedule and keep the evidence: quarterly access reviews, quarterly restore drills, yearly risk assessment and policy review, onboarding and offboarding records, change approvals, incident records, vendor reviews.
3. The auditor tests samples across the window and issues the Type II report. Repeat yearly.

## Recurring calendar

| Frequency    | Activity                                                                                              | Evidence                                     |
| ------------ | ----------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Every change | Pull request with CI green                                                                            | GitHub history                               |
| Weekly       | Dependency update pull requests reviewed                                                              | Dependabot PRs                               |
| Quarterly    | Access review of every production system                                                              | Signed review record                         |
| Quarterly    | Backup restore drill                                                                                  | Runbook table                                |
| Yearly       | Risk assessment, policy review, security training, tabletop exercise, vendor review, penetration test | Documents and records in the compliance tool |
