import { emailDeliverJob } from './emailDeliver';

/** Every job the worker runs; shared by the worker and the owner-only pg-boss migration. */
export const jobs = [emailDeliverJob] as const;
