import { apiHandler } from '@/server/api';
import { pushUnsubscribeRoute } from '@/server/routes/push';

export const POST = apiHandler(pushUnsubscribeRoute);
