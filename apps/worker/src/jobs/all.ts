import { emailDeliverJob } from './emailDeliver';
import { pausesEndJob } from './pausesEnd';

/** Every job the worker runs; shared by the worker and the owner-only pg-boss migration. */
export const jobs = [emailDeliverJob, pausesEndJob] as const;
