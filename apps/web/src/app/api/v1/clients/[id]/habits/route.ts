import { apiHandler } from '@/server/api';
import { habitsListRoute, habitsPostRoute } from '@/server/routes/habits';

export const GET = apiHandler(habitsListRoute);
export const POST = apiHandler(habitsPostRoute);
