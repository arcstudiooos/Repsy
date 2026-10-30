import type { CheckinSubmittedHook } from '@kinetic/core';

/**
 * Event-driven review flags written in the triggering transaction (D-005 review-queue timing). Sprint 4 Task 4.4
 * fills these in; until then a submission raises nothing.
 */
export const onCheckinSubmitted: CheckinSubmittedHook = async () => {};
