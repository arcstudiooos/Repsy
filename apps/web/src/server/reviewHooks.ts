import type { CheckinSubmittedHook, MessageSentHook } from '@kinetic/core';

/**
 * Event-driven review flags written in the triggering transaction (D-005 review-queue timing). Sprint 4 Task 4.4
 * fills these in; until then nothing is raised.
 */
export const onCheckinSubmitted: CheckinSubmittedHook = async () => {};
export const onMessageSent: MessageSentHook = async () => {};
