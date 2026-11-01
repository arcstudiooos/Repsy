import { apiHandler } from '@/server/api';
import {
  calendarLinkDeleteRoute,
  calendarLinkGetRoute,
  calendarLinkPostRoute,
} from '@/server/routes/calendarLink';

export const GET = apiHandler(calendarLinkGetRoute);
export const POST = apiHandler(calendarLinkPostRoute);
export const DELETE = apiHandler(calendarLinkDeleteRoute);
