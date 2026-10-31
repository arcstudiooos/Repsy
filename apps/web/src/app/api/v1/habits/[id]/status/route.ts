import { apiHandler } from '@/server/api';
import { habitStatusRoute } from '@/server/routes/habits';

export const PUT = apiHandler(habitStatusRoute);
