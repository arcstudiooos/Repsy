import { apiHandler } from '@/server/api';
import { meRoute } from '@/server/routes/me';

export const GET = apiHandler(meRoute);
