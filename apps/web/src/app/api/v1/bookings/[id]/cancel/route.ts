import { apiHandler } from '@/server/api';
import { bookingCancelRoute } from '@/server/routes/scheduling';

export const POST = apiHandler(bookingCancelRoute);
