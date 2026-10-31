# Retention dashboards (PostHog)

Built only from the §13 events the app sends (see `packages/core/src/ports/analytics.ts`). Every id is a keyed hash; there are no names or free text, so dashboards are per hashed coach or organization, never per person.

| Insight | Definition |
| --- | --- |
| Weekly active coaches | Unique `distinct_id` with any coach event (`program_created`, `program_assigned`, `review_flag_resolved`, `coach_message_sent`) per week |
| Coach retention | Cohort by first `coach_signed_up` week; retained if any coach event in week N |
| Client weekly activity | Unique `client_id_hash` on `workout_completed` per week, by `org_id_hash` |
| Workout completion trend | `workout_completed` per week; break down by `logged_by_coach` |
| Check-in response | `checkin_submitted` per week vs check-ins issued (in-app analytics page shows the exact ratio) |
| Review follow-through | `review_flag_opened` vs `review_flag_resolved` by `rule_key` and `action` |
| Errors seen | `error_visible` by `code` and `route` |

In-app `/app/analytics` remains the source for adherence (numerator, denominator, period). PostHog is for trends across the pilot.
