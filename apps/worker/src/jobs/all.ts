import { checkinsIssueJob } from './checkinsIssue';
import { emailDeliverJob } from './emailDeliver';
import { exportsBuildJob } from './exportsBuild';
import { pausesEndJob } from './pausesEnd';
import { reviewSweepJob } from './reviewSweep';

/** Every job the worker runs; shared by the worker and the owner-only pg-boss migration. */
export const jobs = [
  emailDeliverJob,
  pausesEndJob,
  checkinsIssueJob,
  reviewSweepJob,
  exportsBuildJob,
] as const;
