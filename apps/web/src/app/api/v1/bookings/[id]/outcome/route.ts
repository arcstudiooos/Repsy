import { apiHandler } from '@/server/api';
import { bookingOutcomeRoute } from '@/server/routes/scheduling';

export const POST = apiHandler(bookingOutcomeRoute);
