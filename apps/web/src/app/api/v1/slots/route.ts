import { apiHandler } from '@/server/api';
import { slotsGetRoute } from '@/server/routes/scheduling';

export const GET = apiHandler(slotsGetRoute);
