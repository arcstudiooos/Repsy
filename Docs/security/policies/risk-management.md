# Risk management policy

**Owner:** security lead. **Review:** risk assessment yearly, and after major changes.

## Method

1. List assets (customer data, production systems, source code, accounts) and threats to each.
2. Score each risk: likelihood (1 to 5) times impact (1 to 5).
3. Choose a treatment: reduce (add a control), transfer (insurance, contract), avoid (stop the activity) or accept (written, by the security lead, for scores 9 or lower; higher scores need a plan).
4. Record it in the register with an owner and a review date.

## Starting register

| Risk                                         | L   | I   | Score | Treatment                                                                                     | Owner         |
| -------------------------------------------- | --- | --- | ----- | --------------------------------------------------------------------------------------------- | ------------- |
| A bug lets one workspace read another's data | 2   | 5   | 10    | Reduce: forced RLS on every table, RLS test in CI, pen test focus                             | Security lead |
| Leaked production secret                     | 3   | 5   | 15    | Reduce: secret store only, no secrets in repo or chat, rotate on exposure, secret scanning    | Security lead |
| Account takeover of a coach                  | 3   | 4   | 12    | Reduce: breach-checked passwords, 2FA required for teams, SSO option, rate limits             | Security lead |
| AI assistant leaks or misuses data           | 2   | 4   | 8     | Reduce: off by default, read-only tools scoped to the workspace, no training; accept residual | Security lead |
| Data loss                                    | 2   | 4   | 8     | Reduce: daily backups, quarterly restore drill                                                | Security lead |
| Sub-processor breach                         | 2   | 4   | 8     | Transfer and reduce: vendor review, DPA terms, minimal data shared                            | Security lead |
| Vulnerable dependency                        | 4   | 3   | 12    | Reduce: Dependabot, audit before release, fix times                                           | Security lead |
| Lost or stolen laptop                        | 3   | 3   | 9     | Reduce: disk encryption, screen lock, no customer data on laptops                             | Each person   |
| Founder unavailable                          | 2   | 4   | 8     | Reduce: break-glass access with a trusted person                                              | Founder       |
