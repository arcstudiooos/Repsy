# Data retention and deletion policy

**Owner:** security lead. **Review:** yearly.

| Data                                                                 | Kept                                                                                                                    | Deleted by                                                                       |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Client records (workouts, check-ins, messages, photos, measurements) | While the coaching relationship and workspace exist                                                                     | Erasure on request within 30 days (`packages/core/src/privacy/deletion.ts`)      |
| Workspace data after the subscription ends                           | Read-only and exportable for 90 days (clients) and 180 days (coaches), per PRD M12 (`packages/core/src/lapse/lapse.ts`) | Deletion schedule after closure: to be decided and added here before paid launch |
| AI assistant conversations                                           | 90 days                                                                                                                 | Daily worker job (`aiPurge`)                                                     |
| Exports                                                              | Until the export's expiry time                                                                                          | Download refused after expiry (`packages/core/src/exports/exports.ts`)           |
| Sessions                                                             | 7 days, refreshed while used                                                                                            | On sign-out, password reset or expiry                                            |
| Calendar tokens                                                      | While connected                                                                                                         | On disconnect (and revoked at Google)                                            |
| Database backups                                                     | 35 days or less                                                                                                         | Provider retention                                                               |
| Application logs and error reports                                   | Per provider settings, 30 to 90 days                                                                                    | Provider retention                                                               |
| Audit log                                                            | For the life of the workspace                                                                                           | With the workspace                                                               |

Rules:

1. Collect only what a feature needs.
2. Erasure covers backups by expiry: nothing is restored from a backup without re-applying erasures done since.
3. Changing a retention period updates this table, the privacy policy and the code in the same change.
