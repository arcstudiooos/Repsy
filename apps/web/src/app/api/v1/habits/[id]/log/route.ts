import { apiHandler } from '@/server/api';
import { habitLogRoute } from '@/server/routes/habits';

export const POST = apiHandler(habitLogRoute);
