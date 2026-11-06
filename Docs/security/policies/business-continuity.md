# Business continuity and disaster recovery

**Owner:** security lead. **Review:** yearly. **Restore drill:** quarterly.

## Targets

| Measure                                          | Target                                                                                              |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Recovery point objective (most data we can lose) | 24 hours (daily backups). Workout logs queued offline on client devices are re-sent after recovery. |
| Recovery time objective (longest outage)         | 8 hours for a full database restore; 1 hour for an app rollback.                                    |

## Backups

- Render Postgres daily backups, kept 35 days or less (so erased data is gone from backups within 35 days).
- Uploaded files in Cloudflare R2 (provider durability). Exports are temporary by design.
- Source code in GitHub; infrastructure settings in `render.yaml`.

## Scenarios

| Scenario                     | Response                                                                                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Bad deploy                   | Roll back on Render (`docs/runbook.md`, Rollback).                                                                                       |
| Database corruption or loss  | Restore the latest good backup to a new database, point the services at it, verify, then announce. Never restore over the live database. |
| Render region outage         | Wait for the provider if short; for a long outage, restore the latest backup into a new region and switch DNS in Cloudflare.             |
| Cloudflare outage            | The app is unavailable; files cannot be served. Communicate and wait.                                                                    |
| Email provider outage        | Emails are queued in the outbox table and sent when Resend recovers.                                                                     |
| Loss of the founder's access | Break-glass credentials in the password manager's emergency access, held by a named trusted person.                                      |

## Clients keep working during short outages

The client portal stores the next 7 days of workouts and logs sets on the device; the outbox sends them when the server is back (PRD D4, M11).

## Drill

Each quarter, follow the restore drill in `docs/runbook.md` (Backups and restore) and record the result in its table.
