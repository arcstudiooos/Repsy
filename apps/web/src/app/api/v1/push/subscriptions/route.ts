import { apiHandler } from '@/server/api';
import { pushSubscribeRoute } from '@/server/routes/push';

export const POST = apiHandler(pushSubscribeRoute);
