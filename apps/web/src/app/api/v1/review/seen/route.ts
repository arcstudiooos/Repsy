import { apiHandler } from '@/server/api';
import { reviewSeenRoute } from '@/server/routes/review';

export const POST = apiHandler(reviewSeenRoute);
