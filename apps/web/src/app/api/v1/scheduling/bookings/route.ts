import { apiHandler } from '@/server/api';
import { bookingsListRoute, bookingsPostRoute } from '@/server/routes/scheduling';

export const GET = apiHandler(bookingsListRoute);
export const POST = apiHandler(bookingsPostRoute);
