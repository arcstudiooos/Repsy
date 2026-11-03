import { apiHandler } from '@/server/api';
import { calendarConnectCallbackRoute } from '@/server/routes/scheduling';

export const GET = apiHandler(calendarConnectCallbackRoute);
