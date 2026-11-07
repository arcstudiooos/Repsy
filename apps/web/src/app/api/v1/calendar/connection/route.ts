import { apiHandler } from '@/server/api';
import {
  calendarConnectionDeleteRoute,
  calendarConnectionGetRoute,
} from '@/server/routes/calendarSync';

export const GET = apiHandler(calendarConnectionGetRoute);
export const DELETE = apiHandler(calendarConnectionDeleteRoute);
