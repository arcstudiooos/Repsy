# Sub-processors

Third parties that process Customer Data for Repsy. Keep this list, the privacy policy (`apps/web/src/app/privacy/page.tsx`) and the DPA annex in step. Give customers at least 30 days' notice before adding one.

| Sub-processor | What it does for Repsy                                                                                       | Data it handles                                                              | Location                            | When                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------- |
| Render        | Hosts the web app, background worker and Postgres database                                                   | All Customer Data                                                            | United States                       | Always                                                                       |
| Cloudflare    | Network protection; private file storage (R2) for uploads and exports; video streaming for coach demo videos | Files, exports, request metadata; demo videos                                | Global                              | Always (Stream only when configured)                                         |
| Resend        | Sends account and notification emails                                                                        | Name, email address, email content                                           | United States                       | Always                                                                       |
| Sentry        | Error reports                                                                                                | Request metadata and error context                                           | United States or EU                 | When configured                                                              |
| PostHog       | Product analytics                                                                                            | Pseudonymous ids, page and feature events                                    | United States or EU                 | Only if turned on                                                            |
| Anthropic     | AI assistant answers                                                                                         | The workspace data a question needs (clients, programs, check-ins, messages) | United States                       | Only if a workspace manager turns the assistant on. No training on the data. |
| Google        | Google sign-in; Google Calendar sync for coaches who connect it                                              | Name, email; booking times and titles pushed to the coach's own calendar     | United States                       | Only for users who choose it                                                 |
| Microsoft     | Microsoft Entra ID single sign-on                                                                            | Name, email, directory id                                                    | Per the customer's Microsoft tenant | Only for workspaces that set it up                                           |

No live payment processor is connected yet (billing runs on a placeholder provider). Add the processor here, in the privacy policy and in the DPA annex before turning one on. Repsy never stores full card numbers.

## Change log

| Date       | Change                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------- |
| 2026-11-06 | List created. Added Anthropic (AI assistant), Google Calendar sync, Cloudflare Stream and Microsoft Entra ID. |
