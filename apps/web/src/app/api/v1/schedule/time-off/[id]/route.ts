import { apiHandler } from '@/server/api';
import { timeOffDeleteRoute } from '@/server/routes/scheduling';

export const DELETE = apiHandler(timeOffDeleteRoute);
