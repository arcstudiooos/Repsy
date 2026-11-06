import { apiHandler } from '@/server/api';
import { calendarGoogleConnectRoute } from '@/server/routes/calendarSync';

export const GET = apiHandler(calendarGoogleConnectRoute);
