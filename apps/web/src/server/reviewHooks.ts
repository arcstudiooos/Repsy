import {
  onCheckinSubmittedRules,
  type CheckinSubmittedHook,
  type MessageSentHook,
} from '@kinetic/core';

/**
 * Event-driven review flags written in the triggering transaction (D-005 review-queue timing): a sent check-in
 * resolves its overdue flag and opens "New check-in sent". Unread messages are time-based (the sweep).
 */
export const onCheckinSubmitted: CheckinSubmittedHook = onCheckinSubmittedRules;
export const onMessageSent: MessageSentHook = async () => {};
