import { apiHandler } from '@/server/api';
import { challengeDeleteRoute, challengePutRoute } from '@/server/routes/challenges';

export const PUT = apiHandler(challengePutRoute);
export const DELETE = apiHandler(challengeDeleteRoute);
