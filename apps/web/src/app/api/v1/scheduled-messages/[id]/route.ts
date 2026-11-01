import { apiHandler } from '@/server/api';
import { scheduledDeleteRoute } from '@/server/routes/scheduledMessages';

export const DELETE = apiHandler(scheduledDeleteRoute);
