import { checkinsIssueJob } from './checkinsIssue';
import { deletionsRunJob } from './deletionsRun';
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
  deletionsRunJob,
] as const;
