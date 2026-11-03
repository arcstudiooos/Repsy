import { apiHandler } from '@/server/api';
import { timeOffPostRoute } from '@/server/routes/scheduling';

export const POST = apiHandler(timeOffPostRoute);
