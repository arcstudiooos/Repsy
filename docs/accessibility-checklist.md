# Accessibility checklist (WCAG 2.2 AA, S5-5)

Automated: every UI spec runs axe (wcag2a, wcag2aa, wcag21aa, wcag22aa) at 375 and 1440 (some at 768) and checks for horizontal overflow. Axe catches roughly a third of issues; the manual pass below covers the rest. Run it on the core journeys before the pilot and after any large UI change, with a keyboard only and with a screen reader (VoiceOver on iOS/macOS, NVDA on Windows).

| Area            | Check                                                                                                                                      | Status                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Keyboard        | Every control is reachable with Tab in a sensible order; focus is always visible; no keyboard trap (dialogs return focus to their trigger) | Covered by specs for the builder (reorder), client tabs and dialogs; re-check the review queue and admin console manually |
| Skip link       | "Skip to content" is the first focusable element in both shells                                                                            | Present in the coach and portal shells                                                                                    |
| Headings        | One h1 per page; sections nest (h2 → h3) without skipping                                                                                  | Fixed for the review page (activity sections are h3)                                                                      |
| Forms           | Every input has a visible label; errors are linked with `aria-describedby` and announced (`role="alert"`)                                  | Check-ins, pause, notes, review dialogs and the builder follow this                                                       |
| Status messages | Sync status ("Saved on device", "Syncing", "Synced"), draft saves and export state use `role="status"`                                     | In place                                                                                                                  |
| Target size     | Touch targets ≥ 44px on portal screens (WCAG 2.5.8 needs 24px; the product rule is 44px)                                                   | Set row inputs, check-in options, buttons; spot-check new screens                                                         |
| Color           | Text contrast ≥ 4.5:1 (D-008 #18 tokens); status never by color alone (badges carry text)                                                  | Tokens validated; "Needs review" badge has text                                                                           |
| Motion          | Animations 120–180 ms and off with `prefers-reduced-motion`                                                                                | Tailwind motion tokens                                                                                                    |
| Zoom and reflow | 200% zoom and 320px width without loss of content                                                                                          | Re-check the inbox two-pane layout and the review filters                                                                 |
| Screen reader   | Workout logging: each set's fields are named "Set N reps"; the finished summary reads as a list; dialogs announce title and description    | Verify with VoiceOver on a phone before the pilot                                                                         |
| Time limits     | No session timeouts that lose data: drafts and the offline outbox keep input                                                               | In place                                                                                                                  |

Record each manual pass:

| Date | Who | Journeys | Findings    |
| ---- | --- | -------- | ----------- |
| —    | —   | —        | Not run yet |
