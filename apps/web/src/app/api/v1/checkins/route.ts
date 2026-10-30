import { apiHandler } from '@/server/api';
import { checkinsListRoute } from '@/server/routes/checkins';

export const GET = apiHandler(checkinsListRoute);
