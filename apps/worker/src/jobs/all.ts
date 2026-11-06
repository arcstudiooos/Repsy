import { videoStreamJob } from './videoStream';
import { calendarSyncJob } from './calendarSync';
import { aiPurgeJob } from './aiPurge';
import { billingSweepJob } from './billingSweep';
import { checkinsIssueJob } from './checkinsIssue';
import { clientRemindersJob } from './clientReminders';
import { coachDigestJob } from './coachDigest';
import { deletionsRunJob } from './deletionsRun';
import { emailDeliverJob } from './emailDeliver';
import { exportsBuildJob } from './exportsBuild';
import { mediaPurgeJob } from './mediaPurge';
import { pushDeliverJob } from './pushDeliver';
import { automationsJob } from './automations';
import { phasesAdvanceJob } from './phasesAdvance';
import { scheduledMessagesJob } from './scheduledMessages';
import { pausesEndJob } from './pausesEnd';
import { reviewSweepJob } from './reviewSweep';

/** Every job the worker runs; shared by the worker and the owner-only pg-boss migration. */
export const jobs = [
  emailDeliverJob,
  pausesEndJob,
  checkinsIssueJob,
  reviewSweepJob,
  exportsBuildJob,
  deletionsRunJob,
  coachDigestJob,
  clientRemindersJob,
  mediaPurgeJob,
  pushDeliverJob,
  scheduledMessagesJob,
  phasesAdvanceJob,
  automationsJob,
  billingSweepJob,
  aiPurgeJob,
  calendarSyncJob,
  videoStreamJob,
] as const;
