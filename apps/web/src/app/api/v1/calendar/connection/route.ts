import { apiHandler } from '@/server/api';
import { calendarConnectionGetRoute, calendarDisconnectRoute } from '@/server/routes/scheduling';

export const GET = apiHandler(calendarConnectionGetRoute);
export const DELETE = apiHandler(calendarDisconnectRoute);
