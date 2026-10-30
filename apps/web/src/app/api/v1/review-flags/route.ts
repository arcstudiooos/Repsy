import { apiHandler } from '@/server/api';
import { reviewFlagPostRoute, reviewFlagsListRoute } from '@/server/routes/reviewFlags';

export const GET = apiHandler(reviewFlagsListRoute);
export const POST = apiHandler(reviewFlagPostRoute);
