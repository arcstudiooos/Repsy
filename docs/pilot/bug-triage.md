# Bug triage during the pilot

| Severity | Meaning | Response |
| --- | --- | --- |
| S1 | Data loss, data shown to the wrong person, can't sign in or log a workout | Fix or roll back the same day; tell affected coaches |
| S2 | A core journey is blocked for some users; wrong numbers on analytics or review | Fix within 2 working days |
| S3 | Workaround exists; cosmetic issue on a core screen | Next weekly release |
| S4 | Nice to have | Backlog; decide at the go/no-go |

**Cadence:** daily 15-minute check of Sentry, worker logs and the pilot inbox; weekly triage of everything open with the founder; weekly release (Render deploy) after `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e` is green.

**Every fix** gets a test that fails before it, and a line in the next sprint's follow-ups file.
