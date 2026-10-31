import { apiHandler } from '@/server/api';
import { reviewFlagPatchRoute } from '@/server/routes/reviewFlags';

export const PATCH = apiHandler(reviewFlagPatchRoute);
