import { apiHandler } from '@/server/api';
import { bookingsGetRoute, bookingsPostRoute } from '@/server/routes/scheduling';

export const GET = apiHandler(bookingsGetRoute);
export const POST = apiHandler(bookingsPostRoute);
