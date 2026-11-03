import { apiHandler } from '@/server/api';
import { calendarConnectStartRoute } from '@/server/routes/scheduling';

export const GET = apiHandler(calendarConnectStartRoute);
