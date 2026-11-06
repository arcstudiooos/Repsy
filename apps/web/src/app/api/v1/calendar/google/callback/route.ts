import { apiHandler } from '@/server/api';
import { calendarGoogleCallbackRoute } from '@/server/routes/calendarSync';

export const GET = apiHandler(calendarGoogleCallbackRoute);
