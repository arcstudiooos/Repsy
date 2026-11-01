import { apiHandler } from '@/server/api';
import { broadcastRoute } from '@/server/routes/messages';

export const POST = apiHandler(broadcastRoute);
