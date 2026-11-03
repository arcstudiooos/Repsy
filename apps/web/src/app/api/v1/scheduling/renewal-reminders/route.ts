import { apiHandler } from '@/server/api';
import { renewalRemindersRoute } from '@/server/routes/scheduling';

export const POST = apiHandler(renewalRemindersRoute);
