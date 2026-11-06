# Data Processing Agreement (template)

> **Status: draft template. Not legal advice. Have counsel review it before offering it to customers**, and check it against the laws that apply to each customer (India's Digital Personal Data Protection Act 2023, the EU and UK GDPR, and US state privacy laws). Square-bracketed text is to be filled in or chosen.

This Data Processing Agreement ("DPA") forms part of the Repsy Terms of Service (the "Agreement") between:

- **[Customer legal name]**, the coaching business that uses Repsy (the "Customer", acting as data controller / data fiduciary); and
- **[Repsy legal entity name]**, [address] ("Repsy", acting as data processor).

## 1. Definitions

Terms such as _personal data_, _processing_, _controller_, _processor_, _data subject_ and _personal data breach_ have the meanings given in Applicable Data Protection Law. Under India's DPDP Act, _controller_ means _data fiduciary_ and _data subject_ means _data principal_.

- **Applicable Data Protection Law**: all data protection laws that apply to the processing under this DPA.
- **Customer Data**: personal data that the Customer, its staff or its clients put into Repsy.
- **Sub-processor**: a third party that Repsy engages to process Customer Data.

## 2. Roles and scope

2.1 The Customer is the controller of Customer Data. Repsy processes it as processor only to provide the service described in the Agreement.

2.2 Details of the processing are in Annex 1.

2.3 Repsy processes Customer Data only on the Customer's documented instructions. The Agreement, this DPA and the Customer's use and configuration of Repsy (for example turning on the AI assistant or a calendar integration) are the Customer's instructions. Repsy will tell the Customer if it believes an instruction breaks Applicable Data Protection Law.

2.4 The Customer is responsible for having a lawful basis and any needed consent (including explicit consent for health data where required) for the data it puts into Repsy, and for giving its clients the required notices.

## 3. Repsy's obligations

3.1 **Confidentiality.** Everyone at Repsy who can access Customer Data is bound by confidentiality and accesses it only as needed to run and support the service.

3.2 **Security.** Repsy keeps the technical and organisational measures in Annex 2 and may update them as long as protection does not fall.

3.3 **Sub-processors.** The Customer gives general authorisation for the sub-processors in Annex 3. Repsy will give at least [30] days' notice of a new sub-processor (by email or on its sub-processor page). The Customer may object on reasonable data protection grounds; if the parties cannot resolve it, the Customer may end the affected service and get a pro-rata refund of prepaid fees. Repsy imposes data protection terms on each sub-processor at least as protective as this DPA and stays responsible for them.

3.4 **Data subject requests.** Repsy provides features for the Customer to access, correct, export and delete client data (including client data export and erasure). Repsy will help with requests it cannot handle through those features, and will pass on any request it receives directly without answering it, unless the law requires otherwise.

3.5 **Breach notification.** Repsy will notify the Customer without undue delay, and in any case within [48] hours, after becoming aware of a personal data breach affecting Customer Data. The notice will describe what is known (nature, categories and approximate number of people and records, likely consequences, measures taken) and Repsy will update it as more is learned.

3.6 **Assistance.** Repsy will give reasonable help with data protection impact assessments and consultations with regulators about the processing.

3.7 **Return and deletion.** When the Agreement ends, the Customer may export its data for [30] days. Repsy then deletes Customer Data from live systems within [30] days, and it expires from backups within 35 days after that, unless law requires keeping it.

3.8 **Audits.** Repsy will make available the information needed to show compliance with this DPA, including its latest independent penetration test summary and, once available, its SOC 2 report under confidentiality. If that is not enough to meet a legal requirement, the Customer may audit Repsy once a year with [30] days' notice, at its own cost, during business hours, under confidentiality, in a way that does not expose other customers' data.

## 4. International transfers

4.1 Repsy and its sub-processors may process Customer Data in the countries listed in Annex 3, including the United States.

4.2 Where Applicable Data Protection Law requires a transfer mechanism, the parties agree to the [EU Standard Contractual Clauses, Module 2 (controller to processor)] [and the UK International Data Transfer Addendum], which are incorporated by reference, with Annex 1 to 3 of this DPA completing their annexes. Transfers from India follow any restrictions the Indian government notifies under section 16 of the DPDP Act.

## 5. Liability and order of precedence

5.1 Each party's liability under this DPA is subject to the limits in the Agreement, except where the law does not allow it.

5.2 If this DPA and the Agreement conflict about data protection, this DPA wins. If the Standard Contractual Clauses apply and conflict with this DPA, the Clauses win.

## 6. Term

This DPA lasts as long as Repsy processes Customer Data for the Customer.

---

## Annex 1: Details of processing

| Item                        | Description                                                                                                                                                                                                                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Subject matter and purpose  | Providing the Repsy coaching platform: client management, training programmes, workout logging, check-ins, messaging, nutrition, scheduling and group classes, payments records, progress tracking, and (if turned on) the AI assistant and calendar sync.                                             |
| Duration                    | The term of the Agreement plus the deletion periods in clause 3.7.                                                                                                                                                                                                                                     |
| Nature of processing        | Collection, storage, organisation, display, transmission, analysis, export and deletion.                                                                                                                                                                                                               |
| Data subjects               | The Customer's staff (owners, admins, coaches, assistants); the Customer's clients and leads.                                                                                                                                                                                                          |
| Categories of personal data | Names, email addresses, phone numbers, profile photos; training and workout logs; body measurements and progress photos; check-in answers; messages; booking and class attendance; payment records (no full card numbers); device and usage data (IP address, user agent, pseudonymous analytics ids). |
| Special categories          | Health-related data (injuries, body measurements, progress photos, check-in answers about wellbeing, nutrition). Processed only as the Customer directs.                                                                                                                                               |
| Frequency                   | Continuous.                                                                                                                                                                                                                                                                                            |

## Annex 2: Technical and organisational measures

See `docs/security/controls.md` for the current list, summarised for customers as:

- Workspace isolation enforced by the database (row-level security on every tenant table).
- Encryption in transit (TLS, HSTS) and at rest (managed database and object storage; extra app-level encryption for integration tokens).
- Strong authentication: 12-character minimum passwords with breach checks, email verification, two-step sign-in (required for multi-coach workspaces), optional single sign-on.
- Role-based access control on every operation; time-limited, audited support access.
- Owner-visible audit log of changes.
- Daily backups kept 35 days or less, quarterly restore tests.
- Code review and automated testing for every change; weekly dependency updates; annual independent penetration test.
- Incident response plan with customer notice within [48] hours.
- Staff confidentiality obligations and least-privilege access to production.

## Annex 3: Sub-processors

See `docs/security/subprocessors.md` (keep the public page in step with it).
