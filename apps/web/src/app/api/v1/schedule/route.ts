import { apiHandler } from '@/server/api';
import { scheduleGetRoute } from '@/server/routes/scheduling';

export const GET = apiHandler(scheduleGetRoute);
