# Repsy security programme (PRD M14)

This folder holds Repsy's security programme: what we protect, the controls already in the product, the policies the team follows, and the plan to get to an annual penetration test and SOC 2.

Owner: the founder (acting security lead) until a dedicated person is hired. Review every document here at least once a year and after any major incident or architecture change.

## What is here

| Document                               | Purpose                                                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| [controls.md](controls.md)             | The technical controls Repsy has today, with where each lives in the code. The evidence base for the pen test and SOC 2. |
| [pentest-plan.md](pentest-plan.md)     | Scope, rules of engagement, vendor selection and retest process for the annual penetration test.                         |
| [dpa-template.md](dpa-template.md)     | Data processing agreement for coaching businesses (Repsy as processor). Needs legal review before use.                   |
| [soc2-readiness.md](soc2-readiness.md) | Gap assessment against the SOC 2 Trust Services Criteria, and the path from Type I to Type II.                           |
| [subprocessors.md](subprocessors.md)   | Every third party that processes customer data, what for, and where.                                                     |
| [policies/](policies/)                 | The written policies an auditor asks for.                                                                                |

## Timeline

| When                    | Milestone                                                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Now (pilot)             | Controls documented; policies adopted; DPA template ready for legal review; vulnerability disclosure live (`SECURITY.md`); automated dependency updates on. |
| Before paid launch      | First external penetration test (web app and API), findings fixed and retested. DPA reviewed by counsel and offered to every paying workspace.              |
| Launch + 3 months       | Compliance automation tool chosen (Vanta, Drata, Secureframe or Sprinto); evidence collection running.                                                      |
| Launch + 6 months       | SOC 2 Type I report (design of controls at a point in time).                                                                                                |
| Type I + 6 to 12 months | SOC 2 Type II report (controls operating over the observation window). Then yearly.                                                                         |
| Every year              | Penetration test, policy review, access review each quarter, restore drill each quarter, tabletop incident exercise.                                        |

## Principles

1. Tenant isolation is enforced by the database (Postgres row-level security, forced), not only by application code.
2. Collect the least data that does the job; delete on request within 30 days; backups expire within 35 days.
3. Health data is sensitive by default: no AI provider sees it unless the workspace turns the assistant on, and providers may not train on it.
4. Every change ships through review and CI. Nobody changes production by hand without a record.
