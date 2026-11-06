# Vendor management policy

**Owner:** security lead. **Review:** yearly, with a review of every vendor that handles customer data.

## Before adding a vendor that will process customer data

1. Write down what data it will get, and why it needs it. Send the least data that works.
2. Check its security: a SOC 2 Type II or ISO 27001 report, or a completed security questionnaire.
3. Sign a data processing agreement with terms at least as strong as Repsy's DPA (confidentiality, security, breach notice, sub-processor control, deletion, transfer mechanism).
4. Confirm where it stores and processes data.
5. Add it to `../subprocessors.md`, the privacy policy and the DPA annex, and give customers at least 30 days' notice.
6. Prefer settings that keep data minimal: no training on our data, shortest retention, EU or US region as customers need.

## Yearly review

For each vendor in `../subprocessors.md`: collect the latest assurance report, check for breaches in the past year, confirm the data shared is still needed, and record the review.

## Ending a vendor

Remove access and keys, request deletion of Repsy data and keep the confirmation, and update the sub-processor list.
