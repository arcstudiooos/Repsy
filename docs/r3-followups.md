# R3 follow-ups

What is left after the R3 completion work (D-013). Everything below is built and tested against fakes; these are
the things only the founder can do, and the limits worth knowing.

## Accounts and settings to create before switching a provider on

None of these are needed to run the app: with them blank the feature is simply off (or uses its fake in development).

| Feature               | Create                                                     | Set                                                                                                                                                                                                                                           |
| --------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Token sealing         | a random 32-byte key (`openssl rand -hex 32`)              | `PROVIDER_TOKEN_KEY` (required in production before anyone connects Razorpay or a calendar; never change it without re-connecting)                                                                                                            |
| Stripe Connect (K1)   | a Stripe platform account with Connect (Standard accounts) | `STRIPE_SECRET_KEY`, `STRIPE_CONNECT_CLIENT_ID`, `STRIPE_WEBHOOK_SECRET`; webhook endpoint `<APP_BASE_URL>/api/webhooks/payments/stripe` (Connect events)                                                                                     |
| Razorpay (K2)         | a Razorpay partner app                                     | `RAZORPAY_CLIENT_ID`, `RAZORPAY_CLIENT_SECRET`, `RAZORPAY_WEBHOOK_SECRET`; webhook endpoint `<APP_BASE_URL>/api/webhooks/payments/razorpay`                                                                                                   |
| Google Calendar (K10) | a Google Cloud OAuth client (web)                          | `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`; redirect URI `<APP_BASE_URL>/api/v1/calendar/connect/google/callback`; scopes `calendar.events.owned`, `calendar.freebusy`, `openid`, `email` (needs Google's app verification) |
| Outlook (K10)         | a Microsoft Entra app registration (multi-tenant)          | `MS_CALENDAR_CLIENT_ID`, `MS_CALENDAR_CLIENT_SECRET`; redirect URI `<APP_BASE_URL>/api/v1/calendar/connect/outlook/callback`; `Calendars.ReadWrite`, `User.Read`, `offline_access`                                                            |
| AI drafting (I10-I12) | an Anthropic API key                                       | `ANTHROPIC_API_KEY`; each workspace owner still turns it on in Settings                                                                                                                                                                       |
| Branded sending (L4)  | nothing new: uses the Resend account                       | `RESEND_API_KEY` (already required for email)                                                                                                                                                                                                 |

`render.yaml` does not list the new variables yet (no deployment work in this pass); add them as `sync: false`
secrets when a provider is switched on. `FAKE_PAYMENTS`, `FAKE_CALENDAR` and `FAKE_AI` must stay unset in
production (they are ignored there anyway).

## Custom domains (L4)

- The app verifies a domain's TXT record and then serves it, but the hosting platform must also accept the
  hostname and issue its TLS certificate. On Render that is one custom domain per hostname on the web service,
  added by hand (or through Render's API, not built). Until it is added, the domain resolves but the host refuses it.
- Branded sending registers the domain with Resend once the TXT record verifies; the coach then adds Resend's DKIM
  and SPF records, shown in Settings. Emails switch to `hello@<domain>` when Resend reports the domain verified.

## Known limits

- **Payments:** the Razorpay adapter can't discount the first charge of a subscription (Razorpay plans have no
  one-off coupon), so such a checkout is refused with a clear message. Prices are tax-inclusive; Stripe Tax is used
  only when the workspace turns it on. Credits from a pack stay usable while its purchase is past due or cancelled.
- **Scheduling:** one weekly-hours time zone per coach; no rescheduling (cancel and book again) and no waitlist.
  Busy times from a connected calendar refresh every 15 minutes, so a just-added calendar event can take that long
  to hide a slot. All staff see every booking in the workspace (including call links). Recurring and buffer rules
  apply to new bookings only.
- **AI drafting:** name and contact redaction and the injury/medical keyword screen are best effort. Drafts are
  never saved without the coach; highlights are never stored. The daily cap counts failed requests.
- **Lapse (M12):** clients' own provider subscriptions are not cancelled automatically when a workspace lapses.
- **Lint:** the two known `window.location.assign` warnings remain (pre-existing).
