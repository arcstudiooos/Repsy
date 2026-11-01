import { apiHandler } from '@/server/api';
import { pushGetRoute } from '@/server/routes/push';

export const GET = apiHandler(pushGetRoute);
